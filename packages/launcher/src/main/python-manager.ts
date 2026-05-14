// Legacy Python environment detector.
//
// The launcher no longer depends on Python — agents run via the Node-based
// agent-connector. This module is kept for compatibility with any UI that
// still reports a "Python" status; it always reports the Node runtime as
// healthy and returns null for python-specific fields.

export interface LegacyPythonStatus {
  pythonPath: string | null;
  pythonFound: boolean;
  sdkInstalled: boolean;
  sdkVersion: string | null;
}

export class PythonManager {
  getStatus(): LegacyPythonStatus {
    return {
      pythonPath: null,
      pythonFound: true,
      sdkInstalled: true,
      sdkVersion: null,
    };
  }

  getPythonPath(): string | null {
    return null;
  }

  async installSDK(): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: 'No installation needed — using Node.js agent-connector',
    };
  }
}
