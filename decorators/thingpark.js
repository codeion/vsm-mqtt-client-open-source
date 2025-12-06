module.exports.api = {
  decorate: (obj, deveui, rawFrame) => {
    // Fallback in case some integration forgets to send rawFrame
    const frame = rawFrame || {};

    let location = {};
    if (obj.output) {
      // keep existing behaviour: deep clone of obj.output
      location = JSON.parse(JSON.stringify(obj.output));
    }

    // Inject positioning info from solver/translator result
    location.latitude = obj.latitude;
    location.longitude = obj.longitude;
    location.accuracy = obj.accuracy;
    location.timestamp = obj.positionTimestamp;
    location.appName = obj.vsm && obj.vsm.appName ? obj.vsm.appName : 'unknown';

    frame.location = location;

    return frame;
  },

  getVersionString: () => {
    return 'ThingPark Object Decorator';
  }
};
