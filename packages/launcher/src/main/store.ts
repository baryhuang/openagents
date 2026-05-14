import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import type { AppSettings } from '../shared/models';

export class Store {
  private _data: AppSettings;
  private _pathResolved = false;
  private _path: string | null = null;

  constructor(defaults: AppSettings = {}) {
    this._data = { ...defaults };
  }

  private _ensurePath(): void {
    if (this._pathResolved) return;
    this._path = path.join(app.getPath('userData'), 'settings.json');
    this._pathResolved = true;
    this._load();
  }

  private _load(): void {
    try {
      if (this._path && fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8');
        this._data = { ...this._data, ...JSON.parse(raw) };
      }
    } catch {
      // ignore corrupt file
    }
  }

  private _save(): void {
    this._ensurePath();
    if (!this._path) return;
    try {
      fs.mkdirSync(path.dirname(this._path), { recursive: true });
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  get<K extends keyof AppSettings>(key?: K): AppSettings[K] | AppSettings {
    this._ensurePath();
    if (key === undefined) return { ...this._data };
    return this._data[key];
  }

  set<K extends keyof AppSettings>(key: K | AppSettings, value?: AppSettings[K]): void {
    if (typeof key === 'object' && key !== null) {
      Object.assign(this._data, key);
    } else {
      this._data[key as K] = value as AppSettings[K];
    }
    this._save();
  }

  delete(key: keyof AppSettings): void {
    delete this._data[key];
    this._save();
  }

  has(key: keyof AppSettings): boolean {
    return key in this._data;
  }
}
