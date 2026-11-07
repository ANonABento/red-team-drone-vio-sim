// The shared world: ground, light and sun, built once per renderer.
// The environment stage and the drone stage both fly over this, so a saved
// scenario (surface, light, seed, patches) is the same ground in both.
import { buildGround, WORLD, MED_TILE, DET_TILE } from "./textures.js";

const T = window.THREE;
export const SUN_DISC = 0.0093; // the sun's angular size, radians: sets how soft a shadow is

export const LIGHTS = {
  noon: { name: "Clear, high sun", elev: 50, az: 160, sun: 3.0, sky: 1.0, shadow: true, exposure: 1 },
  low: { name: "Low November sun", elev: 18, az: 200, sun: 2.6, sky: 0.8, shadow: true, exposure: 1.05 },
  overcast: { name: "Overcast", elev: 40, az: 180, sun: 0.35, sky: 2.2, shadow: false, exposure: 1 },
  dusk: { name: "Dusk, after sunset", elev: 2, az: 240, sun: 0.15, sky: 0.35, shadow: false, exposure: 1 },
  flood: { name: "Night, under a floodlight", elev: 60, az: 0, sun: 0, sky: 0.03, shadow: true, flood: true, exposure: 1 },
  dark: { name: "Dark, city sky glow only", elev: 60, az: 0, sun: 0, sky: 0.08, shadow: false, exposure: 1 },
  hall: { name: "Indoors, hall lights", elev: 85, az: 30, sun: 0.6, sky: 0.7, shadow: false, exposure: 1 }
};

export function createWorld(renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const scene = new T.Scene();

  const hemi = new T.HemisphereLight(new T.Color(0.75, 0.82, 1), new T.Color(0.35, 0.32, 0.28), 1);
  scene.add(hemi);
  const sun = new T.DirectionalLight(new T.Color(1, 0.96, 0.88), 3);
  sun.castShadow = true;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const flood = new T.SpotLight(new T.Color(1, 0.93, 0.8), 0, 400, 0.75, 0.5, 2);
  flood.position.set(28, 14, 18);
  flood.castShadow = true;
  flood.shadow.mapSize.set(2048, 2048);
  flood.shadow.bias = -0.0002;
  scene.add(flood, flood.target);

  const uniforms = {
    medMap: { value: null }, detA: { value: null }, detB: { value: null }, maskMap: { value: null },
    medRep: { value: WORLD / MED_TILE }, detRep: { value: WORLD / DET_TILE }
  };
  const groundMat = new T.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", "uniform sampler2D medMap, detA, detB, maskMap; uniform float medRep, detRep;\nvoid main() {")
      .replace("#include <map_fragment>", `
        #ifdef USE_MAP
          vec4 macroCol = texture2D( map, vMapUv );
          vec4 mk = texture2D( maskMap, vMapUv );
          vec2 u1 = vMapUv * detRep;
          vec2 u2 = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * detRep * 0.37 + 0.31;
          vec3 dA = texture2D( detA, u1 ).rgb * 2.0 * ( 0.6 + 0.8 * texture2D( detA, u2 ).rgb );
          vec3 dB = texture2D( detB, u1 ).rgb * 2.0 * ( 0.6 + 0.8 * texture2D( detB, u2 ).rgb );
          vec3 med = texture2D( medMap, vMapUv * medRep ).rgb * 2.0;
          vec3 tex = mix( vec3( 1.0 ), med * mix( dA, dB, mk.r ), mk.g );
          diffuseColor.rgb *= macroCol.rgb * tex;
        #endif`);
  };
  const groundGeo = new T.PlaneGeometry(WORLD, WORLD, 256, 256);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new T.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  let height = () => 0;

  function tex(B, srgb) {
    const t = new T.DataTexture(B.d, B.n, B.n, T.RGBAFormat, T.UnsignedByteType);
    t.wrapS = t.wrapT = B.wrap ? T.RepeatWrapping : T.ClampToEdgeWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = maxAniso;
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  let builtKey = "";
  // Returns true when it rebuilt the ground.
  function rebuild(surface, seed, patches) {
    const key = `${surface}|${seed}|${patches}`;
    if (key === builtKey) return false;
    builtKey = key;
    const g = buildGround(surface, seed, patches);
    for (const k of ["medMap", "detA", "detB", "maskMap"]) uniforms[k].value?.dispose();
    groundMat.map?.dispose();
    groundMat.map = tex(g.macro, true);
    uniforms.medMap.value = tex(g.med, false);
    uniforms.detA.value = tex(g.det, false);
    uniforms.detB.value = tex(g.det2, false);
    uniforms.maskMap.value = tex(g.mask, false);
    groundMat.needsUpdate = true;
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, g.height(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    groundGeo.computeVertexNormals();
    height = g.height;
    return true;
  }

  function applyLight(lightId, shadow) {
    const L = LIGHTS[lightId];
    hemi.intensity = L.sky;
    sun.intensity = L.sun;
    flood.intensity = L.flood ? 2600 : 0;
    const e = L.elev * Math.PI / 180, a = L.az * Math.PI / 180;
    sun.userData.dir = new T.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    sun.castShadow = shadow && L.shadow && !L.flood;
    flood.castShadow = shadow && !!L.flood;
    flood.target.position.set(0, 0, 0);
    return L;
  }

  // Point the sun's shadow box at the drone: softer and fainter the further the ground is.
  function aimSun(at, h, box = 0.6) {
    const dir = sun.userData.dir || new T.Vector3(0, 1, 0);
    const along = h / Math.max(0.05, dir.y);
    const penumbra = along * SUN_DISC;
    sun.position.copy(at).addScaledVector(dir, 20);
    sun.target.position.copy(at);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -box; cam.right = cam.top = box; cam.near = 1; cam.far = 25 + along + 10;
    cam.updateProjectionMatrix();
    const size = Math.max(32, Math.min(2048, 2 ** Math.round(Math.log2(box * 2 / Math.max(0.002, penumbra / 2)))));
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    sun.shadow.intensity = Math.max(0.05, Math.min(0.9, 0.9 * (1 - penumbra / 0.6)));
    flood.shadow.intensity = Math.max(0.1, Math.min(0.95, 0.95 * (1 - (h * 0.04) / 0.6)));
  }

  return { scene, hemi, sun, flood, ground, rebuild, applyLight, aimSun, heightAt: (x, z) => height(x, z) };
}
