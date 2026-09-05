import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.join(__dirname, '.env');

export function loadEnvFile() {
  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

export function saveEnvFile(vars) {
  let existing = {};
  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        existing[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  }

  const merged = { ...existing, ...vars };
  for (const [k, v] of Object.entries(merged)) {
    process.env[k] = String(v);
  }

  let out = '# Turkcell TV+ IPTV Yapılandırması\n';
  for (const [k, v] of Object.entries(merged)) {
    out += `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, out, 'utf-8');
}

// Initial load
loadEnvFile();

export const CONFIG = {
  get port() {
    return parseInt(process.env.PORT || '3000', 10);
  },
  iptv: {
    get host() {
      return process.env.IPTV_HOST || '';
    },
    get username() {
      return process.env.IPTV_USERNAME || '';
    },
    get password() {
      return process.env.IPTV_PASSWORD || '';
    },
    set host(val) {
      process.env.IPTV_HOST = val;
    },
    set username(val) {
      process.env.IPTV_USERNAME = val;
    },
    set password(val) {
      process.env.IPTV_PASSWORD = val;
    }
  },
  cacheTTL: 24 * 60 * 60 * 1000, // 24 hours (1 day) in ms
  parental: {
    get pin() {
      return process.env.ADULT_PIN || '0000';
    },
    set pin(val) {
      process.env.ADULT_PIN = String(val || '0000');
    },
    get enabled() {
      return process.env.ENABLE_ADULT !== 'false';
    },
    set enabled(val) {
      process.env.ENABLE_ADULT = String(val);
    }
  }
};
