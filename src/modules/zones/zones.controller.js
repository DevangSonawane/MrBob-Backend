const catchAsync = require('../../utils/catchAsync');
const service = require('./zones.service');

const listCities = catchAsync(async (req, res) => {
  const cities = await service.listCities();
  res.status(200).json({ success: true, data: cities });
});

const createCity = catchAsync(async (req, res) => {
  const city = await service.createCity(req.body);
  res.status(201).json({ success: true, data: city });
});

const listZones = catchAsync(async (req, res) => {
  const zones = await service.listZones(req.query.cityId);
  res.status(200).json({ success: true, data: zones });
});

const createZone = catchAsync(async (req, res) => {
  const zone = await service.createZone(req.body);
  res.status(201).json({ success: true, data: zone });
});

module.exports = { listCities, createCity, listZones, createZone };
