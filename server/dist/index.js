"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const arcgisClient_1 = require("./arcgisClient");
const routes_1 = require("./routes");
const config = (0, config_1.loadConfig)();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const client = new arcgisClient_1.ArcgisClient({
    layerUrl: config.layerUrl,
    referer: config.referer,
});
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.use('/api/properties', (0, routes_1.createPropertiesRouter)({ client }));
const clientBuildPath = path_1.default.resolve(__dirname, '../../client/dist');
if (fs_1.default.existsSync(clientBuildPath)) {
    app.use(express_1.default.static(clientBuildPath));
    app.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(clientBuildPath, 'index.html'));
    });
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: err.message });
});
app.listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
});
