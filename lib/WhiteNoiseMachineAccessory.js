const BaseAccessory = require('./BaseAccessory');
const async = require('async');

class WhiteNoiseMachineAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.LIGHTBULB;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.Switch, this.device.context.name);
        this.accessory.addService(Service.Lightbulb, this.device.context.name + ' Light');

        const useVolume = this._coerceBoolean(this.device.context.useVolume, false);
        if (useVolume) {
            this.accessory.addService(Service.Speaker, this.device.context.name + ' Volume');
        }

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;

        const serviceWhiteNoise = this.accessory.getService(Service.Switch);
        const serviceLight = this.accessory.getService(Service.Lightbulb);

        this._checkServiceName(serviceWhiteNoise, this.device.context.name);
        this._checkServiceName(serviceLight, this.device.context.name + ' Light');

        this.dpWhiteNoise = this._getCustomDP(this.device.context.dpWhiteNoise) || '8';
        this.dpLight = this._getCustomDP(this.device.context.dpLight) || '3';
        this.dpColor = this._getCustomDP(this.device.context.dpColor) || '5';
        this.dpMode = this._getCustomDP(this.device.context.dpMode) || '2';
        this.dpVolume = this._getCustomDP(this.device.context.dpVolume) || '9';

        this.useColor = this._coerceBoolean(this.device.context.useColor, true);
        this.useVolume = this._coerceBoolean(this.device.context.useVolume, false);

        // This device uses HSB colour format (h:0-360, s:0-1000, v:0-1000).
        // Equivalent to the cloud plugin's schema property defaults for h/s/v ranges.
        if (!this.device.context.colorFunction) this.device.context.colorFunction = 'HSB';
        this._detectColorFunction(dps[this.dpColor]);

        this.cmdColor = 'colour';
        if (this.device.context.cmdColor) {
            if (/^c[a-z]+$/i.test(this.device.context.cmdColor)) this.cmdColor = ('' + this.device.context.cmdColor).trim();
            else throw new Error(`The cmdColor doesn't appear to be valid: ${this.device.context.cmdColor}`);
        }

        // White noise switch
        const characteristicWhiteNoiseOn = serviceWhiteNoise.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpWhiteNoise])
            .on('get', this.getState.bind(this, this.dpWhiteNoise))
            .on('set', this.setState.bind(this, this.dpWhiteNoise));

        // Light on/off
        const characteristicLightOn = serviceLight.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpLight])
            .on('get', this.getState.bind(this, this.dpLight))
            .on('set', this.setState.bind(this, this.dpLight));

        // Color characteristics (Hue, Saturation, Brightness from colour_data)
        let characteristicHue, characteristicSaturation, characteristicBrightness;
        if (this.useColor) {
            const initialColor = this.convertColorFromTuyaToHomeKit(dps[this.dpColor]);

            characteristicBrightness = serviceLight.getCharacteristic(Characteristic.Brightness)
                .updateValue(initialColor.b)
                .on('get', this.getBrightness.bind(this))
                .on('set', this.setBrightness.bind(this));

            characteristicHue = serviceLight.getCharacteristic(Characteristic.Hue)
                .updateValue(initialColor.h)
                .on('get', this.getHue.bind(this))
                .on('set', this.setHue.bind(this));

            characteristicSaturation = serviceLight.getCharacteristic(Characteristic.Saturation)
                .updateValue(initialColor.s)
                .on('get', this.getSaturation.bind(this))
                .on('set', this.setSaturation.bind(this));

            // Stored on this for access in _setHueSaturation
            this.characteristicHue = characteristicHue;
            this.characteristicSaturation = characteristicSaturation;
        }

        // Optional volume on a Speaker service
        let characteristicVolume;
        if (this.useVolume) {
            const serviceSpeaker = this.accessory.getService(Service.Speaker)
                || this.accessory.addService(Service.Speaker, this.device.context.name + ' Volume');

            this._checkServiceName(serviceSpeaker, this.device.context.name + ' Volume');

            // Mute is required by Speaker; tie it to the white noise on/off state
            serviceSpeaker.getCharacteristic(Characteristic.Mute)
                .updateValue(!dps[this.dpWhiteNoise])
                .on('get', (callback) => callback(null, !this.device.state[this.dpWhiteNoise]))
                .on('set', (value, callback) => this.setState(this.dpWhiteNoise, !value, callback));

            characteristicVolume = serviceSpeaker.getCharacteristic(Characteristic.Volume)
                .updateValue(dps[this.dpVolume] || 0)
                .on('get', this.getState.bind(this, this.dpVolume))
                .on('set', this.setState.bind(this, this.dpVolume));
        }

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpWhiteNoise) && characteristicWhiteNoiseOn.value !== changes[this.dpWhiteNoise]) {
                characteristicWhiteNoiseOn.updateValue(changes[this.dpWhiteNoise]);
                if (this.useVolume) {
                    const serviceSpeaker = this.accessory.getService(Service.Speaker);
                    if (serviceSpeaker) {
                        serviceSpeaker.getCharacteristic(Characteristic.Mute).updateValue(!changes[this.dpWhiteNoise]);
                    }
                }
            }

            if (changes.hasOwnProperty(this.dpLight) && characteristicLightOn.value !== changes[this.dpLight])
                characteristicLightOn.updateValue(changes[this.dpLight]);

            if (this.useColor && changes.hasOwnProperty(this.dpColor)) {
                const oldColor = this.convertColorFromTuyaToHomeKit(this.convertColorFromHomeKitToTuya({
                    h: characteristicHue.value,
                    s: characteristicSaturation.value,
                    b: characteristicBrightness.value
                }));
                const newColor = this.convertColorFromTuyaToHomeKit(changes[this.dpColor]);

                if (oldColor.h !== newColor.h) characteristicHue.updateValue(newColor.h);
                if (oldColor.s !== newColor.s) characteristicSaturation.updateValue(newColor.s);
                if (oldColor.b !== newColor.b) characteristicBrightness.updateValue(newColor.b);
            }

            if (characteristicVolume && changes.hasOwnProperty(this.dpVolume) && characteristicVolume.value !== changes[this.dpVolume])
                characteristicVolume.updateValue(changes[this.dpVolume]);

            this.log.info('WhiteNoiseMachine changed: ' + JSON.stringify(state));
        });
    }

    getBrightness(callback) {
        callback(null, this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).b);
    }

    setBrightness(value, callback) {
        this.setMultiState({
            [this.dpMode]: this.cmdColor,
            [this.dpColor]: this.convertColorFromHomeKitToTuya({b: value})
        }, callback);
    }

    getHue(callback) {
        callback(null, this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).h);
    }

    setHue(value, callback) {
        this._setHueSaturation({h: value}, callback);
    }

    getSaturation(callback) {
        callback(null, this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).s);
    }

    setSaturation(value, callback) {
        this._setHueSaturation({s: value}, callback);
    }

    // Debounces Hue and Saturation into a single colour_data update, matching the
    // RGBTWLightAccessory pattern — HomeKit fires them as separate set calls but
    // the device needs both merged into one hex string.
    _setHueSaturation(prop, callback) {
        if (!this._pendingHueSaturation) {
            this._pendingHueSaturation = {props: {}, callbacks: []};
        }

        if (prop) {
            if (this._pendingHueSaturation.timer) clearTimeout(this._pendingHueSaturation.timer);

            this._pendingHueSaturation.props = {...this._pendingHueSaturation.props, ...prop};
            this._pendingHueSaturation.callbacks.push(callback);

            this._pendingHueSaturation.timer = setTimeout(() => {
                this._setHueSaturation();
            }, 500);
            return;
        }

        const callbacks = this._pendingHueSaturation.callbacks;
        const callEachBack = err => {
            async.eachSeries(callbacks, (callback, next) => {
                try { callback(err); } catch (ex) {}
                next();
            });
        };

        const newValue = this.convertColorFromHomeKitToTuya(this._pendingHueSaturation.props);
        this._pendingHueSaturation = null;

        this.setMultiState({[this.dpMode]: this.cmdColor, [this.dpColor]: newValue}, callEachBack);
    }
}

module.exports = WhiteNoiseMachineAccessory;
