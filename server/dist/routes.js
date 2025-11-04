"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPropertiesRouter = createPropertiesRouter;
const express_1 = require("express");
const ownerTable_1 = require("./ownerTable");
function createPropertiesRouter(options) {
    const router = (0, express_1.Router)();
    router.get('/', async (_req, res, next) => {
        try {
            const payload = await options.client.fetchAllFeatures({
                returnGeometry: true,
            });
            const formattedFeatures = (0, ownerTable_1.formatOwnerTable)(payload.features ?? []);
            res.json({
                features: formattedFeatures,
                fields: (0, ownerTable_1.buildOwnerFields)(),
            });
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
