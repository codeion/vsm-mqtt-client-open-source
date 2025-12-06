const LOG = require('../utils/log');

module.exports.api = {
  decorate: (obj, deveui, rawFrame) => {
    LOG.info(obj);
    // Inner Actility frame (DevEUI_uplink content)
    const frame = rawFrame || {};

    // Start with any existing output from translator (if you use it)
    let location = {};
    if (obj.output) {
      location = JSON.parse(JSON.stringify(obj.output));
    }

    // Core position fields from solver / translator
    location.loc_latitude  = (typeof obj.latitude  === 'number') ? obj.latitude  : null;
    location.loc_longitude = (typeof obj.longitude === 'number') ? obj.longitude : null;
    location.loc_accuracy  = (typeof obj.accuracy  === 'number') ? obj.accuracy  : null;
    location.loc_altitude  = (typeof obj.altitude  === 'number') ? obj.altitude  : null;

    // Optional solver meta – adapt these paths if your translator stores them differently
    if (obj.algorithmType) {
      location.loc_algorithm = obj.algorithmType;
    }
    if (typeof obj.numberOfGatewaysReceived === 'number') {
      location.loc_gatewaysReceived = obj.numberOfGatewaysReceived;
    }
    if (typeof obj.numberOfGatewaysUsed === 'number') {
      location.loc_gatewaysUsed = obj.numberOfGatewaysUsed;
    }

    // Warnings / errors from solver (stringified for easy table view)
    if (Array.isArray(obj.warnings) && obj.warnings.length > 0) {
      location.loc_warning = obj.warnings.join(' | ');
    }
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      location.loc_error = obj.errors.join(' | ');
    }

    // Timestamp when solver ran / position was evaluated
    location.loc_timestamp = obj.positionTimestamp || null;

    // Attach to frame and wrap as DevEUI_uplink for TB
    frame.location = location;

    return { DevEUI_uplink: frame };
  },

  getVersionString: () => {
    return 'ThingPark Object Decorator';
  }
};
