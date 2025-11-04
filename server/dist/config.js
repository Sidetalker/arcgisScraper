"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DEFAULT_LAYER_URL = 'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';
const DEFAULT_PORTAL_URL = 'https://summitcountyco.maps.arcgis.com';
const DEFAULT_REFERER = 'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/';
function loadEnvFile() {
    const envPath = path_1.default.resolve(process.cwd(), '.env');
    if (fs_1.default.existsSync(envPath)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('dotenv').config({ path: envPath });
    }
}
function loadConfig() {
    loadEnvFile();
    const layerUrl = process.env.ARCGIS_LAYER_URL ?? DEFAULT_LAYER_URL;
    const portalUrl = process.env.ARCGIS_PORTAL_URL ?? DEFAULT_PORTAL_URL;
    const referer = process.env.ARCGIS_REFERER ?? DEFAULT_REFERER;
    const port = Number(process.env.PORT ?? 3000);
    return {
        layerUrl,
        portalUrl,
        referer,
        port,
    };
}
