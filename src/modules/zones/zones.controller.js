const catchAsync = require('../../utils/catchAsync');
const service = require('./zones.service');
const pincodes = require('./serviceability.service');

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

const removeCity = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.removeCity(req.params.id) }));

const removeZone = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.removeZone(req.params.id) }));

const updateCity = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.updateCity(req.params.id, req.body) }));

const updateZone = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await service.updateZone(req.params.id, req.body) }));

const checkPincode = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await pincodes.check(req.query.pincode) }));

const listPincodes = catchAsync(async (req, res) => res.status(200).json({ success: true, ...(await pincodes.list(req.query)) }));

const addPincodes = catchAsync(async (req, res) => res.status(201).json({ success: true, data: await pincodes.add(req.body) }));

const updatePincode = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await pincodes.update(req.params.id, req.body) }));

const removePincode = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await pincodes.remove(req.params.id) }));

module.exports = { removeCity, removeZone, listCities, createCity, updateCity, listZones, createZone, updateZone, checkPincode, listPincodes, addPincodes, updatePincode, removePincode };
