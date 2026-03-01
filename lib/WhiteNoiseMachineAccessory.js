const BaseAccessory = require('./BaseAccessory');

class WhiteNoiseMachineAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.LIGHTBULB;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.Lightbulb, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;

        const serviceLight = this.accessory.getService(Service.Lightbulb);
        this._checkServiceName(serviceLight, this.device.context.name);

        // DP 3: switch_led — light on/off
        this.dpLight = this._getCustomDP(this.device.context.dpLight) || '3';

        const characteristicOn = serviceLight.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpLight])
            .on('get', this.getState.bind(this, this.dpLight))
            .on('set', this.setState.bind(this, this.dpLight));

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpLight) && characteristicOn.value !== changes[this.dpLight])
                characteristicOn.updateValue(changes[this.dpLight]);

            this.log.info('WhiteNoiseMachine changed: ' + JSON.stringify(state));
        });
    }
}

module.exports = WhiteNoiseMachineAccessory;
