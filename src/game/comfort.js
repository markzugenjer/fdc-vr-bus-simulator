import * as THREE from 'three';

/**
 * Comfort vignette: when the bus turns, speeds up or brakes, the edges of your view softly
 * darken (a "tunnel"), which takes away most of the motion your eyes see but your body doesn't
 * feel. When driving straight and steady it fades away completely.
 */
export class Vignette {
  constructor(camera) {
    this.amount = 0; // 0..1, smoothed
    this.level = 0.6; // settings strength
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAmount: { value: 0 }, uColor: { value: new THREE.Color('#0d1a12') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uAmount; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          float r = length((vUv - 0.5) * vec2(2.0, 2.0));
          float inner = mix(1.25, 0.42, uAmount);
          float a = smoothstep(inner, inner + 0.38, r) * min(1.0, uAmount * 1.6);
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    // a plane just in front of the eyes, big enough to cover the Quest's field of view
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), this.mat);
    this.mesh.position.z = -0.12;
    this.mesh.renderOrder = 9000;
    this.mesh.frustumCulled = false;
    camera.add(this.mesh);
  }

  setLevel(name) { this.level = name === 'kuat' ? 1 : name === 'mati' ? 0 : 0.6; }

  /** yawRate (rad/s) and accel (m/s²) of the bus. */
  update(dt, yawRate, accel, speed) {
    const want = this.level === 0 ? 0 : Math.min(1, (Math.abs(yawRate) * 2.2 + Math.max(0, Math.abs(accel) - 0.6) * 0.22) * (speed > 0.5 ? 1 : 0)) * this.level;
    // close quickly, open slowly
    const k = want > this.amount ? 1 - Math.exp(-dt * 6) : 1 - Math.exp(-dt * 1.6);
    this.amount += (want - this.amount) * k;
    this.mat.uniforms.uAmount.value = this.amount;
    this.mesh.visible = this.amount > 0.01;
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.mat.dispose(); this.mesh.geometry.dispose(); }
}
