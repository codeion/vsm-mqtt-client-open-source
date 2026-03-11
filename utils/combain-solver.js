const isNil = require('lodash/isNil');
const get = require('lodash/get');

const isZeroCoordinatePair = (latitude, longitude) =>
  Number(latitude) === 0 && Number(longitude) === 0;

const hasValidCoordinates = (latitude, longitude) =>
  !isNil(latitude) &&
  !isNil(longitude) &&
  !Number.isNaN(Number(latitude)) &&
  !Number.isNaN(Number(longitude)) &&
  !isZeroCoordinatePair(latitude, longitude);

const normalizeGnssResult = (result) => {
  if (!result) return null;

  const latitude = get(result, 'llh[0]');
  const longitude = get(result, 'llh[1]');
  const altitude = get(result, 'llh[2]', 0);

  if (!hasValidCoordinates(latitude, longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    altitude,
    accuracy: get(result, 'accuracy', null),
    algorithmType: 'GPS',
    numberOfGatewaysReceived: 0,
    numberOfGatewaysUsed: 0,
  };
};

const normalizeSolverResponse = (response, isWifi) => {
  if (!response || !response.result || isWifi) {
    return response;
  }

  const normalized = normalizeGnssResult(response.result);

  return {
    ...response,
    result: normalized,
  };
};

module.exports = {
  isZeroCoordinatePair,
  hasValidCoordinates,
  normalizeGnssResult,
  normalizeSolverResponse,
};
