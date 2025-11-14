// DeviceOrientationControls.js (ES module, modernized)
// Vendored from three/examples; converted to class + small fixes.
// Usage: import { DeviceOrientationControls } from './controls/DeviceOrientationControls.js';

import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

export class DeviceOrientationControls {
  constructor(object) {
    this.object = object;
    this.object.rotation.reorder('YXZ');

    this.enabled = true;
    this.deviceOrientation = {};
    this.screenOrientation = 0; // degrees
    this.alphaOffset = 0; // radians

    // Bind handlers
    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
    this._onScreenOrientationChange = this._onScreenOrientationChange.bind(this);

    // Internal helpers reused per update
    this._zee = new Vector3(0, 0, 1);
    this._euler = new Euler();
    this._q0 = new Quaternion();
    this._q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

    // Start listening immediately (matches original behavior)
    this.connect();
  }

  // --- Public helpers --------------------------------------------------------

  /**
   * iOS 13+ requires a user gesture + permission. Call this inside a click/touch.
   * Resolves 'granted' | 'denied' | 'not-supported'
   */
  static async requestPermission() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      try {
        return await D.requestPermission(); // 'granted' | 'denied'
      } catch {
        return 'denied';
      }
    }
    return 'not-supported';
  }

  getAlphaOffsetAngle() { return this.alphaOffset; }
  setAlphaOffsetAngle(angle /* radians */) { this.alphaOffset = angle; }

  // --- Event handlers --------------------------------------------------------

  _onDeviceOrientation(event) {
    this.deviceOrientation = event || {};
  }

  _onScreenOrientationChange() {
    // window.orientation is deprecated; prefer screen.orientation.angle when available
    const scr = window.screen && window.screen.orientation;
    this.screenOrientation = (scr && typeof scr.angle === 'number') ? scr.angle : (window.orientation || 0);
  }

  // --- Lifecycle -------------------------------------------------------------

  connect() {
    this._onScreenOrientationChange(); // once on load

    // iOS 13+ note: you still must call requestPermission() from a user gesture.
    window.addEventListener('orientationchange', this._onScreenOrientationChange, false);
    window.addEventListener('deviceorientation', this._onDeviceOrientation, false);

    this.enabled = true;
  }

  disconnect() {
    window.removeEventListener('orientationchange', this._onScreenOrientationChange, false);
    window.removeEventListener('deviceorientation', this._onDeviceOrientation, false);
    this.enabled = false;
  }

  dispose() { this.disconnect(); }

  // --- Core math -------------------------------------------------------------

  _setObjectQuaternion(quaternion, alpha, beta, gamma, orient) {
    // The angles alpha, beta and gamma form intrinsic Tait-Bryan angles, Z-X'-Y''
    // We convert to 'YXZ' for three.js object.
    this._euler.set(beta, alpha, -gamma, 'YXZ');    // 'ZXY' for device, 'YXZ' for us
    quaternion.setFromEuler(this._euler);           // orient the device
    quaternion.multiply(this._q1);                  // camera looks out the back, not the top
    quaternion.multiply(this._q0.setFromAxisAngle(this._zee, -orient)); // adjust for screen
  }

  update() {
    if (!this.enabled) return;

    const device = this.deviceOrientation;
    if (!device) return;

    const alpha = (device.alpha !== null && device.alpha !== undefined)
      ? MathUtils.degToRad(device.alpha) + this.alphaOffset : 0; // Z

    const beta = (device.beta !== null && device.beta !== undefined)
      ? MathUtils.degToRad(device.beta) : 0; // X'

    const gamma = (device.gamma !== null && device.gamma !== undefined)
      ? MathUtils.degToRad(device.gamma) : 0; // Y''

    const orient = this.screenOrientation
      ? MathUtils.degToRad(this.screenOrientation) : 0; // O

    this._setObjectQuaternion(this.object.quaternion, alpha, beta, gamma, orient);
  }
}
