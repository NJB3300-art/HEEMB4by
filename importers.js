// heemb4by – 3D file importers. Loaders are fetched on demand from the three.js addons.
import * as THREE from 'three';

const ADDONS = 'three/addons/loaders/';

/** Extensions that can be the main file of a model, with a short label. */
export const MODEL_FORMATS = {
  glb: 'glTF binary', gltf: 'glTF', fbx: 'FBX', obj: 'Wavefront OBJ', stl: 'STL', ply: 'PLY',
  dae: 'Collada', '3mf': '3MF', '3ds': '3DS', usdz: 'USDZ', amf: 'AMF', vox: 'MagicaVoxel',
  lwo: 'LightWave', wrl: 'VRML', pcd: 'Point cloud (PCD)', xyz: 'Point cloud (XYZ)',
  gcode: 'G-code', kmz: 'KMZ', vtk: 'VTK', vtp: 'VTK XML', md2: 'Quake MD2',
};
/** Files that only travel with a main file (materials, textures, buffers). */
export const COMPANION = ['mtl', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff', 'ktx2', 'dds'];

export const ACCEPT = [...Object.keys(MODEL_FORMATS), ...COMPANION].map((e) => '.' + e).join(',');

export function ext(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * Groups picked files into models: every main file becomes a model, and every companion
 * file is made available (by file name) to all of them.
 * files: [{ name, data: ArrayBuffer }]
 */
export function groupFiles(files) {
  const mains = files.filter((f) => MODEL_FORMATS[ext(f.name)]);
  const companions = files.filter((f) => !MODEL_FORMATS[ext(f.name)]);
  // An .obj takes the .mtl files with it; other formats take textures/buffers.
  return mains.map((m) => ({ name: m.name, files: [m, ...companions] }));
}

let urlMap = new Map();
let modifierInstalled = false;

/** Lets loaders find textures/buffers by file name, whatever path the model asks for. */
function installUrlModifier() {
  if (modifierInstalled) return;
  modifierInstalled = true;
  THREE.DefaultLoadingManager.setURLModifier((url) => {
    if (url.startsWith('data:')) return url;
    const clean = decodeURIComponent(url.split('?')[0].split('#')[0]);
    const base = clean.split(/[\\/]/).pop().toLowerCase();
    return urlMap.get(base) || url;
  });
}

function text(buf) { return new TextDecoder().decode(buf); }

const BLOB_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

/**
 * Parses one model (main file + companions) into a THREE.Object3D.
 * Returns { object, animations }.
 */
export async function parseModel(model) {
  installUrlModifier();
  const main = model.files[0];
  const kind = ext(main.name);
  const blobUrls = [];
  urlMap = new Map();
  for (const f of model.files.slice(1)) {
    const u = URL.createObjectURL(new Blob([f.data], { type: BLOB_TYPES[ext(f.name)] || 'application/octet-stream' }));
    blobUrls.push(u);
    urlMap.set(f.name.toLowerCase(), u);
  }

  try {
    const r = await parseByType(kind, main, model.files);
    return r;
  } finally {
    // Keep companion URLs alive briefly so textures that load late still resolve.
    setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 60000);
  }
}

function meshFromGeometry(geo, opts = {}) {
  if (!geo.attributes.normal && geo.index) geo.computeVertexNormals();
  if (!geo.attributes.normal && !opts.points) geo.computeVertexNormals();
  if (opts.points || (!geo.index && !geo.attributes.normal)) {
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.02, vertexColors: !!geo.attributes.color, color: geo.attributes.color ? 0xffffff : 0x8899ff }));
  }
  const mat = new THREE.MeshStandardMaterial({
    color: geo.attributes.color ? 0xffffff : 0xb9b4c8,
    vertexColors: !!geo.attributes.color,
    roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

async function parseByType(kind, main, files) {
  const buf = main.data;
  switch (kind) {
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import(ADDONS + 'GLTFLoader.js');
      const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      // Use <img>-based texture loading (works inside sandboxed pages) rather than fetch.
      const saved = window.createImageBitmap;
      let gltf;
      try {
        window.createImageBitmap = undefined;
        gltf = await new Promise((res, rej) => {
          try { loader.parse(kind === 'gltf' ? text(buf) : buf, '', res, rej); } catch (e) { rej(e); }
          window.createImageBitmap = saved;
        });
      } finally {
        window.createImageBitmap = saved;
      }
      return { object: gltf.scene || gltf.scenes[0], animations: gltf.animations || [] };
    }
    case 'fbx': {
      const { FBXLoader } = await import(ADDONS + 'FBXLoader.js');
      const obj = new FBXLoader().parse(buf, '');
      return { object: obj, animations: obj.animations || [] };
    }
    case 'obj': {
      const { OBJLoader } = await import(ADDONS + 'OBJLoader.js');
      const loader = new OBJLoader();
      const mtl = files.find((f) => ext(f.name) === 'mtl');
      if (mtl) {
        const { MTLLoader } = await import(ADDONS + 'MTLLoader.js');
        const mats = new MTLLoader().parse(text(mtl.data), '');
        mats.preload();
        loader.setMaterials(mats);
      }
      return { object: loader.parse(text(buf)), animations: [] };
    }
    case 'stl': {
      const { STLLoader } = await import(ADDONS + 'STLLoader.js');
      return { object: meshFromGeometry(new STLLoader().parse(buf)), animations: [] };
    }
    case 'ply': {
      const { PLYLoader } = await import(ADDONS + 'PLYLoader.js');
      const geo = new PLYLoader().parse(buf);
      return { object: meshFromGeometry(geo, { points: !geo.index }), animations: [] };
    }
    case 'dae': {
      const { ColladaLoader } = await import(ADDONS + 'ColladaLoader.js');
      const c = new ColladaLoader().parse(text(buf), '');
      return { object: c.scene, animations: c.scene.animations || [] };
    }
    case '3mf': {
      const { ThreeMFLoader } = await import(ADDONS + '3MFLoader.js');
      return { object: new ThreeMFLoader().parse(buf), animations: [] };
    }
    case '3ds': {
      const { TDSLoader } = await import(ADDONS + 'TDSLoader.js');
      return { object: new TDSLoader().parse(buf, ''), animations: [] };
    }
    case 'usdz': {
      const { USDZLoader } = await import(ADDONS + 'USDZLoader.js');
      return { object: new USDZLoader().parse(buf), animations: [] };
    }
    case 'amf': {
      const { AMFLoader } = await import(ADDONS + 'AMFLoader.js');
      return { object: new AMFLoader().parse(buf), animations: [] };
    }
    case 'vox': {
      const { VOXLoader, VOXMesh } = await import(ADDONS + 'VOXLoader.js');
      const chunks = new VOXLoader().parse(buf);
      const g = new THREE.Group();
      for (const ch of chunks) g.add(new VOXMesh(ch));
      g.scale.setScalar(0.1);
      const wrap = new THREE.Group(); wrap.add(g);
      return { object: wrap, animations: [] };
    }
    case 'lwo': {
      const { LWOLoader } = await import(ADDONS + 'LWOLoader.js');
      const r = new LWOLoader().parse(buf, '', main.name);
      const g = new THREE.Group();
      for (const m of r.meshes) g.add(m);
      return { object: g, animations: [] };
    }
    case 'wrl': {
      const { VRMLLoader } = await import(ADDONS + 'VRMLLoader.js');
      return { object: new VRMLLoader().parse(text(buf), ''), animations: [] };
    }
    case 'pcd': {
      const { PCDLoader } = await import(ADDONS + 'PCDLoader.js');
      return { object: new PCDLoader().parse(buf), animations: [] };
    }
    case 'xyz': {
      const { XYZLoader } = await import(ADDONS + 'XYZLoader.js');
      const geo = new XYZLoader().parse(text(buf));
      return { object: meshFromGeometry(geo, { points: true }), animations: [] };
    }
    case 'gcode': {
      const { GCodeLoader } = await import(ADDONS + 'GCodeLoader.js');
      const g = new GCodeLoader().parse(text(buf));
      g.rotation.x = -Math.PI / 2;
      const wrap = new THREE.Group(); wrap.add(g);
      return { object: wrap, animations: [] };
    }
    case 'kmz': {
      const { KMZLoader } = await import(ADDONS + 'KMZLoader.js');
      return { object: new KMZLoader().parse(buf).scene, animations: [] };
    }
    case 'vtk':
    case 'vtp': {
      const { VTKLoader } = await import(ADDONS + 'VTKLoader.js');
      return { object: meshFromGeometry(new VTKLoader().parse(buf, '')), animations: [] };
    }
    case 'md2': {
      const { MD2Loader } = await import(ADDONS + 'MD2Loader.js');
      const geo = new MD2Loader().parse(buf);
      const mesh = meshFromGeometry(geo);
      mesh.morphTargetInfluences && (mesh.material.morphTargets = true);
      return { object: mesh, animations: geo.animations || [] };
    }
    default:
      throw new Error(`.${kind} files aren't supported.`);
  }
}

/** Centers a model on the ground and scales it to a sensible size (≈ 4 units). */
export function normalize(object, targetSize = 4) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 1;
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z) || 1;
  const s = max > targetSize * 4 || max < targetSize / 8 ? targetSize / max : 1;
  return s;
}
