import './model-viewer.css';
import {escapeHtml} from './utils.js';

let threeModulesPromise = null;

function parseModelPayload(preview) {
  try {
    return JSON.parse(preview.content || '');
  } catch {
    return null;
  }
}

export function isNativeModelPayload(preview) {
  return parseModelPayload(preview)?.renderer === 'rage-render';
}

export function renderModelPreview(preview) {
  const payload = parseModelPayload(preview);
  if (!payload)
    return `<div class="unsupported-preview" role="alert"><span class="preview-mark">MODEL ERROR</span><p>The model preview response could not be decoded.</p></div>`;
  if (payload.renderer === 'rage-render') {
    const firstView = payload.views?.[0];
    if (!firstView?.image)
      return `<div class="unsupported-preview" role="alert"><span class="preview-mark">MODEL ERROR</span><p>The GTA V renderer returned no model views.</p></div>`;
    const options = payload.drawables?.length > 1 ?
        `<label class="model-drawable-picker">Drawable <select data-model-drawable>${payload.drawables.map((item, index) => `<option value="${index}" ${index === payload.selectedDrawable ? 'selected' : ''}>${escapeHtml(item.name || `Drawable ${index + 1}`)}</option>`).join('')}</select></label>` :
        '';
    const textureStatus = payload.missingTextures ?
        `${payload.missingTextures} texture${payload.missingTextures === 1 ? '' : 's'} unavailable` :
        `${payload.textures || 0} textures`;
    return `<section class="native-model-preview" data-native-model data-frame-count="${payload.views.length}" data-selected-frame="0" aria-label="GTA V rendered model inspection">
      <div class="native-model-topline"><span class="editor-kicker">RAGE IMAGE-SEQUENCE VIEWER · ${escapeHtml(payload.format)}</span>${options}</div>
      <div class="native-model-workspace">
        <aside class="model-editor-panel native-view-list">
          <div class="model-editor-panel-heading"><span>RENDERED VIEWS</span><span>${payload.views.length}</span></div>
          <div class="native-frame-list" data-native-frame-list>${payload.views.map((view, index) => `<button class="native-frame-row${index === 0 ? ' is-selected' : ''}" type="button" data-native-frame="${index}" aria-pressed="${index === 0}"><span class="native-frame-index">${String(index + 1).padStart(2, '0')}</span><span>${view.azimuth}° azimuth</span></button>`).join('')}</div>
        </aside>
        <div class="native-model-center">
          <div class="native-model-stage" data-model-stage tabindex="0" aria-label="Rendered GTA V model. Drag to orbit and use the mouse wheel to zoom."><img data-native-model-image src="data:image/png;base64,${firstView.image}" alt="Rendered ${escapeHtml(payload.format)} model" draggable="false"></div>
          <div class="native-model-controls">
            <div class="native-frame-controls"><button class="editor-button" data-native-step="-1" type="button" aria-label="Previous rendered view" title="Previous view">‹</button><span data-native-model-status>View 01 / ${String(payload.views.length).padStart(2, '0')} · drag to orbit · wheel to zoom</span><button class="editor-button" data-native-step="1" type="button" aria-label="Next rendered view" title="Next view">›</button></div>
            <div class="native-zoom-controls"><button class="editor-button" data-native-zoom="-1" type="button" aria-label="Zoom out" title="Zoom out">−</button><span data-native-zoom-level>100%</span><button class="editor-button" data-native-zoom="1" type="button" aria-label="Zoom in" title="Zoom in">+</button><button class="editor-button native-reset" data-model-reset type="button">Reset view</button></div>
          </div>
        </div>
        <aside class="model-editor-panel native-model-inspector">
          <div class="model-editor-panel-heading"><span>RESOURCE INFO</span></div>
          <div class="native-inspector-content">
            <span class="inspector-label">RENDERER</span><strong>RAGE · pre-rendered views</strong>
            <span class="inspector-label">FORMAT</span><strong>${escapeHtml(payload.format)}</strong>
            <span class="inspector-label">GEOMETRY</span><strong>${Number(payload.geometries || 0).toLocaleString()} geometries</strong>
            <span class="inspector-label">TRIANGLES</span><strong>${Number(payload.triangles || 0).toLocaleString()}</strong>
            <span class="inspector-label">TEXTURES</span><strong>${escapeHtml(textureStatus)}</strong>
            <p class="native-limitation-note">This renderer provides image-sequence orbit only. Geometry transforms and material editing are unavailable.</p>
          </div>
        </aside>
      </div>
    </section>`;
  }
  return `<section class="model-editor" aria-label="3D model editor">
    <div class="model-editor-toolbar" role="toolbar" aria-label="Viewport tools">
      <div class="editor-tool-group"><span class="editor-group-label">TRANSFORM</span>
        <button class="editor-button is-active" data-editor-mode="select" type="button" aria-pressed="true" title="Select object">Select</button>
        <button class="editor-button" data-editor-mode="translate" type="button" aria-pressed="false" title="Move selected object">Move</button>
        <button class="editor-button" data-editor-mode="rotate" type="button" aria-pressed="false" title="Rotate selected object">Rotate</button>
        <button class="editor-button" data-editor-mode="scale" type="button" aria-pressed="false" title="Scale selected object">Scale</button>
      </div>
      <div class="editor-toolbar-separator"></div>
      <div class="editor-tool-group editor-history-group">
        <button class="editor-button" data-editor-action="undo" type="button" disabled title="Undo last preview transform">Undo</button>
        <button class="editor-button" data-editor-action="reset-transform" type="button" disabled title="Reset selected object transform">Reset transform</button>
      </div>
      <div class="editor-toolbar-separator"></div>
      <div class="editor-tool-group">
        <span class="editor-group-label">VIEW</span>
        <button class="editor-button" data-editor-action="frame" type="button" title="Frame selected object">Frame</button>
        <button class="editor-button" data-editor-view="front" type="button" title="Front view">Front</button>
        <button class="editor-button" data-editor-view="top" type="button" title="Top view">Top</button>
        <button class="editor-button" data-editor-view="side" type="button" title="Side view">Side</button>
      </div>
      <div class="editor-toolbar-separator editor-view-separator"></div>
      <div class="editor-tool-group editor-display-group">
        <button class="editor-button is-toggled" data-editor-toggle="grid" type="button" aria-pressed="true">Grid</button>
        <button class="editor-button is-toggled" data-editor-toggle="axes" type="button" aria-pressed="true">Axes</button>
        <button class="editor-button" data-editor-toggle="wireframe" type="button" aria-pressed="false">Wireframe</button>
      </div>
    </div>
    <div class="model-editor-layout">
      <aside class="model-editor-panel model-editor-outliner">
        <div class="model-editor-panel-heading"><span>SCENE</span><span data-model-object-count>—</span></div>
        <div class="model-editor-list" data-model-outliner><div class="editor-panel-placeholder">Loading scene…</div></div>
      </aside>
      <div class="model-editor-center">
        <div class="model-editor-viewport">
          <canvas data-model-canvas tabindex="0" aria-label="Interactive 3D model. Drag to orbit, right-drag to pan, and use the mouse wheel to zoom."></canvas>
          <div class="model-editor-empty" data-model-empty role="status">Decoding ${escapeHtml(payload.format?.toUpperCase() || 'model')}…</div>
          <div class="model-editor-error" data-model-error role="alert" hidden></div>
          <div class="model-editor-crosshair" aria-hidden="true"><span>X</span><span>Y</span><span>Z</span></div>
        </div>
        <div class="model-editor-status"><span data-model-status role="status">Loading local 3D renderer…</span><span>Orbit: drag · Pan: right-drag · Zoom: wheel</span></div>
      </div>
      <aside class="model-editor-panel model-editor-inspector">
        <div class="model-editor-panel-heading"><span>INSPECTOR</span><span>LOCAL PREVIEW</span></div>
        <div class="model-inspector-content" data-model-inspector><div class="editor-panel-placeholder">Waiting for model…</div></div>
      </aside>
    </div>
  </section>`;
}

function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

function normalizeAssetPath(value) {
    if (typeof value !== 'string' || value.startsWith('data:') ||
        value.startsWith('blob:') || value.startsWith('/') ||
        value.startsWith('//') || value.includes('\\') ||
        value.includes('://') || value.includes(':') || value.includes('?') ||
        value.includes('#'))
      return null;
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }
    if (decoded.startsWith('/') || decoded.includes('://') ||
        /[\\?#:\0]/.test(decoded))
      return null;
    const parts = decoded.split('/').filter((part) => part && part !== '.');
    if (!parts.length || parts.some((part) => part === '..')) return null;
    return parts.join('/');
  }

function mimeForModelAsset(path) {
    const extension = path.split('.').pop().toLowerCase();
    return ({
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tga: 'image/x-tga',
      bin: 'application/octet-stream',
      mtl: 'text/plain',
    })[extension] || 'application/octet-stream';
  }

  function gltfDocumentBytes(format, bytes) {
    if (format !== 'glb') return bytes;
    if (bytes.length < 20) throw new Error('The GLB header is truncated.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(4, true) !== 2)
      throw new Error('Only glTF 2.0 binary models are supported.');
    const declaredLength = view.getUint32(8, true);
    if (declaredLength > bytes.length || declaredLength < 20)
      throw new Error('The GLB length is invalid.');
    let offset = 12;
    while (offset + 8 <= declaredLength) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const end = offset + 8 + length;
      if (end > declaredLength) throw new Error('A GLB chunk is truncated.');
      if (type === 0x4e4f534a) return bytes.subarray(offset + 8, end);
      offset = end;
    }
    throw new Error('The GLB file has no JSON scene chunk.');
  }

  function validateGltfPayload(format, bytes) {
    let document;
    try {
      document = JSON.parse(new TextDecoder().decode(gltfDocumentBytes(format, bytes)));
    } catch (error) {
      throw new Error(`Invalid glTF document: ${error.message || error}`);
    }
    const accessors = document.accessors || [];
    if (accessors.length > 200000 ||
        (document.bufferViews || []).length > 200000 ||
        (document.nodes || []).length > 50000 ||
        (document.meshes || []).length > 50000)
      throw new Error('The glTF scene exceeds the preview complexity limit.');
    let accessorCount = 0;
    for (const accessor of accessors) {
      if (!Number.isSafeInteger(accessor.count) || accessor.count < 0 ||
          accessor.count > 1_000_000)
        throw new Error('A glTF accessor exceeds the preview complexity limit.');
      accessorCount += accessor.count;
      if (accessorCount > 2_000_000)
        throw new Error('The glTF scene exceeds the preview geometry limit.');
    }
    let bufferBytes = 0;
    for (const buffer of document.buffers || []) {
      if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0)
        throw new Error('A glTF buffer has an invalid length.');
      bufferBytes += buffer.byteLength;
      if (bufferBytes > 48 * 1024 * 1024)
        throw new Error('The glTF buffers exceed the 48 MiB preview limit.');
    }
  }

export function mountNativeModelViewer(dialog, preview) {
    const root = dialog?.querySelector('[data-native-model]');
    const payload = parseModelPayload(preview);
    if (!root || !payload?.views?.length) return;
    const stage = root.querySelector('[data-model-stage]');
    const image = root.querySelector('[data-native-model-image]');
    const status = root.querySelector('[data-native-model-status]');
    const zoomLabel = root.querySelector('[data-native-zoom-level]');
    const frames = payload.views;
    let frame = 0;
    let zoom = 1;
    let dragging = false;
    let lastX = 0;

    const showFrame = (index) => {
      frame = (index + frames.length) % frames.length;
      root.dataset.selectedFrame = String(frame);
      image.src = `data:image/png;base64,${frames[frame].image}`;
      status.textContent =
          `View ${String(frame + 1).padStart(2, '0')} / ${String(frames.length).padStart(2, '0')} · ${frames[frame].azimuth}° azimuth`;
      root.querySelectorAll('[data-native-frame]').forEach((button) => {
        const selected = Number(button.dataset.nativeFrame) === frame;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    };
    const setZoom = (value) => {
      zoom = Math.max(.65, Math.min(2.4, value));
      image.style.transform = `scale(${zoom})`;
      if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    };
    root.querySelectorAll('[data-native-frame]').forEach((button) => {
      button.addEventListener(
          'click', () => showFrame(Number(button.dataset.nativeFrame)));
    });
    root.querySelectorAll('[data-native-step]').forEach((button) => {
      button.addEventListener(
          'click', () => showFrame(frame + Number(button.dataset.nativeStep)));
    });
    root.querySelectorAll('[data-native-zoom]').forEach((button) => {
      button.addEventListener('click', () => setZoom(
          zoom + Number(button.dataset.nativeZoom) * .1));
    });
    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      lastX = event.clientX;
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const delta = event.clientX - lastX;
      if (Math.abs(delta) < 14) return;
      const steps = Math.trunc(delta / 14);
      showFrame(frame - steps);
      lastX = event.clientX;
    });
    const release = () => {
      dragging = false;
      stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? .08 : -.08));
    }, {passive: false});
    stage.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') showFrame(frame - 1);
      if (event.key === 'ArrowRight') showFrame(frame + 1);
      if (event.key === '+' || event.key === '=') setZoom(zoom + .1);
      if (event.key === '-') setZoom(zoom - .1);
    });
    root.querySelector('[data-model-reset]')?.addEventListener('click', () => {
      showFrame(0);
      setZoom(1);
    });
    showFrame(0);
  }

  function loadThreeModules() {
    if (!threeModulesPromise) {
      threeModulesPromise = Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/controls/TransformControls.js'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/MTLLoader.js'),
        import('three/addons/loaders/OBJLoader.js'),
      ]).then(([THREE, controls, transform, gltf, mtl, obj]) => ({
        THREE,
        OrbitControls: controls.OrbitControls,
        TransformControls: transform.TransformControls,
        GLTFLoader: gltf.GLTFLoader,
        MTLLoader: mtl.MTLLoader,
        OBJLoader: obj.OBJLoader,
      }));
    }
    return threeModulesPromise;
  }

export function mountModelViewer(dialog, preview) {
  const root = dialog?.querySelector('.model-editor');
  const canvas = root?.querySelector('[data-model-canvas]');
  const status = root?.querySelector('[data-model-status]');
  const empty = root?.querySelector('[data-model-empty]');
  const error = root?.querySelector('[data-model-error]');
  const payload = parseModelPayload(preview);
  if (!root || !canvas || !payload?.data) return null;

  let active = true;
  let animationFrame = 0;
  let renderer = null;
  let controls = null;
  let transformControls = null;
  let resizeObserver = null;
  let model = null;
  let scene = null;
  let grid = null;
  let axes = null;
  let selectionHelper = null;
  let selectedObject = null;
  let meshEntries = [];
  let mode = 'select';
  let wireframe = false;
  let transformBefore = null;
  const undoStack = [];
  const initialTransforms = new Map();
  const originalWireframe = new Map();
  const objectUrls = [];
  const localUrls = new Map();
  const showError = (message) => {
    if (!active) return;
    empty.hidden = true;
    error.hidden = false;
    error.textContent = message;
  };
  const setUndoState = () => {
    const button = root.querySelector('[data-editor-action="undo"]');
    if (button) button.disabled = undoStack.length === 0;
  };
  const snapshot = (object) => ({
    object,
    position: object.position.clone(),
    rotation: object.rotation.clone(),
    scale: object.scale.clone(),
  });
  const remember = (value) => {
    if (!value) return;
    undoStack.push(value);
    if (undoStack.length > 40) undoStack.shift();
    setUndoState();
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    cancelAnimationFrame(animationFrame);
    resizeObserver?.disconnect();
    controls?.dispose();
    transformControls?.dispose();
    if (model) disposeThreeObject(model);
    if (grid) disposeThreeObject(grid);
    if (axes) disposeThreeObject(axes);
    if (selectionHelper) disposeThreeObject(selectionHelper);
    renderer?.renderLists?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    for (const url of objectUrls) URL.revokeObjectURL(url);
  };

  try {
    for (const asset of payload.assets || []) {
      const path = normalizeAssetPath(asset.path);
      if (!path) continue;
      const blob = new Blob([decodeBase64(asset.data)], {
        type: mimeForModelAsset(path)
      });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      localUrls.set(path, url);
    }
  } catch (loadError) {
    showError(`Could not decode this model: ${loadError.message || loadError}`);
    return dispose;
  }

  void loadThreeModules()
      .then(({THREE, OrbitControls, TransformControls, GLTFLoader, MTLLoader, OBJLoader}) => {
        if (!active) return;
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith('data:')) return url;
          const path = normalizeAssetPath(url);
          return (path && localUrls.get(path)) ||
              'data:application/octet-stream;base64,';
        });

        const finish = (object) => {
          if (!active) {
            disposeThreeObject(object);
            return;
          }
          let meshCount = 0;
          let triangleCount = 0;
          let vertexCount = 0;
          const materials = new Set();
          meshEntries = [];
          object.traverse((child) => {
            if (!child.isMesh || !child.geometry?.getAttribute('position'))
              return;
            meshCount++;
            const positions = child.geometry.getAttribute('position');
            vertexCount += positions.count;
            triangleCount += child.geometry.index ?
                child.geometry.index.count / 3 :
                positions.count / 3;
            for (const material of (Array.isArray(child.material) ?
                child.material : [child.material])) {
              if (!material) continue;
              materials.add(material);
              if (!originalWireframe.has(material))
                originalWireframe.set(material, Boolean(material.wireframe));
            }
            meshEntries.push({
              object: child,
              name: child.name?.trim() || `Mesh ${meshEntries.length + 1}`,
            });
          });
          if (!meshCount || !triangleCount) {
            showError(
                'The file decoded, but it contains no renderable triangle geometry.');
            disposeThreeObject(object);
            return;
          }
          try {
            model = object;
            const bounds = new THREE.Box3().setFromObject(model);
            if (bounds.isEmpty()) throw new Error('The model has no finite bounds.');
            const center = bounds.getCenter(new THREE.Vector3());
            const size = bounds.getSize(new THREE.Vector3());
            const radius = Math.max(size.length() * .5, .01);
            const width = Math.max(canvas.clientWidth, 1);
            const height = Math.max(canvas.clientHeight, 1);
            renderer = new THREE.WebGLRenderer({
              canvas,
              antialias: true,
              alpha: false,
              powerPreference: 'low-power'
            });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
            renderer.setSize(width, height, false);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;

            scene = new THREE.Scene();
            scene.background = new THREE.Color('#111518');
            scene.add(model);
            const camera = new THREE.PerspectiveCamera(
                38, width / height, Math.max(radius / 10000, .001), radius * 100);
            const initialCameraPosition = center.clone().add(
                new THREE.Vector3(radius * 1.8, radius * 1.25, radius * 2.4));
            camera.position.copy(initialCameraPosition);
            camera.far = Math.max(radius * 100, 100);
            camera.updateProjectionMatrix();
            scene.add(new THREE.HemisphereLight('#d9e3eb', '#272320', 2.1));
            const keyLight = new THREE.DirectionalLight('#fff0d6', 3.2);
            keyLight.position.copy(center).add(
                new THREE.Vector3(radius * 2, radius * 3, radius * 2));
            scene.add(keyLight);
            const fillLight = new THREE.DirectionalLight('#7a9ab8', 1.1);
            fillLight.position.copy(center).add(
                new THREE.Vector3(-radius * 2, radius, -radius));
            scene.add(fillLight);

            grid = new THREE.GridHelper(
                radius * 5, 24, new THREE.Color('#57636a'),
                new THREE.Color('#343d42'));
            grid.position.set(center.x, bounds.min.y - radius * .012, center.z);
            grid.material.transparent = true;
            grid.material.opacity = .46;
            grid.material.depthWrite = false;
            scene.add(grid);
            axes = new THREE.AxesHelper(radius * 1.25);
            axes.position.copy(center);
            scene.add(axes);

            controls = new OrbitControls(camera, canvas);
            controls.enableDamping = true;
            controls.dampingFactor = .075;
            controls.minDistance = radius * .08;
            controls.maxDistance = radius * 12;
            controls.target.copy(center);
            controls.update();

            transformControls = new TransformControls(camera, canvas);
            const transformHelper = transformControls.getHelper();
            scene.add(transformHelper);
            transformControls.addEventListener('mouseDown', () => {
              if (selectedObject) transformBefore = snapshot(selectedObject);
              if (controls) controls.enabled = false;
            });
            transformControls.addEventListener('mouseUp', () => {
              if (transformBefore && selectedObject) {
                const changed = !transformBefore.position.equals(selectedObject.position) ||
                    !transformBefore.rotation.equals(selectedObject.rotation) ||
                    !transformBefore.scale.equals(selectedObject.scale);
                if (changed) remember(transformBefore);
              }
              transformBefore = null;
              if (controls) controls.enabled = true;
              updateInspector();
            });

            const selectObject = (entry) => {
              selectedObject = entry?.object || null;
              if (selectionHelper) {
                scene.remove(selectionHelper);
                disposeThreeObject(selectionHelper);
                selectionHelper = null;
              }
              if (selectedObject) {
                selectionHelper = new THREE.BoxHelper(
                    selectedObject, new THREE.Color('#7bd4e4'));
                selectionHelper.visible = selectedObject.visible;
                scene.add(selectionHelper);
                if (mode === 'select') transformControls.detach();
                else {
                  transformControls.attach(selectedObject);
                  transformControls.setMode(mode);
                }
              } else {
                transformControls.detach();
              }
              renderOutliner();
              updateInspector();
              root.querySelector('[data-editor-action="reset-transform"]').disabled =
                  !selectedObject;
            };
            const renderOutliner = () => {
              const list = root.querySelector('[data-model-outliner]');
              const count = root.querySelector('[data-model-object-count]');
              count.textContent = String(meshEntries.length);
              list.innerHTML = meshEntries.map((entry, index) =>
                `<div class="model-outliner-row${entry.object === selectedObject ? ' is-selected' : ''}">
                  <button class="model-outliner-select" type="button" data-outliner-select="${index}" aria-pressed="${entry.object === selectedObject}" title="Select ${escapeHtml(entry.name)}"><span class="outliner-mesh-icon" aria-hidden="true">◇</span><span class="outliner-object-name">${escapeHtml(entry.name)}</span></button>
                  <button class="model-outliner-visibility" type="button" data-outliner-visibility="${index}" aria-label="${entry.object.visible ? 'Hide' : 'Show'} ${escapeHtml(entry.name)}" aria-pressed="${entry.object.visible}" title="${entry.object.visible ? 'Hide' : 'Show'} object">${entry.object.visible ? '◉' : '○'}</button>
                </div>`).join('');
            };
            const renderInspector = () => {
              const target = root.querySelector('[data-model-inspector]');
              if (!selectedObject) {
                target.innerHTML = `<div class="editor-panel-placeholder">Select a mesh in the scene to inspect its local transform.</div>
                  <div class="model-inspector-stats"><span class="inspector-label">SCENE STATISTICS</span><dl>
                    <dt>Meshes</dt><dd>${meshCount.toLocaleString()}</dd><dt>Triangles</dt><dd>${Math.floor(triangleCount).toLocaleString()}</dd><dt>Vertices</dt><dd>${vertexCount.toLocaleString()}</dd><dt>Materials</dt><dd>${materials.size.toLocaleString()}</dd>
                  </dl></div>`;
                return;
              }
              const input = (label, axis, value, type) =>
                `<label class="transform-field"><span>${label}</span><input type="number" step="0.01" value="${Number(value).toFixed(3)}" data-transform-axis="${axis}" data-transform-type="${type}" aria-label="${type} ${axis}"></label>`;
              const angles = selectedObject.rotation;
              target.innerHTML = `<div class="inspector-object-name"><span class="outliner-mesh-icon" aria-hidden="true">◇</span><strong>${escapeHtml(selectedObject.name?.trim() || meshEntries.find((entry) => entry.object === selectedObject)?.name || 'Mesh')}</strong></div>
                <section class="transform-section"><h3>POSITION <span>LOCAL</span></h3><div class="transform-fields">${input('X', 'x', selectedObject.position.x, 'position')}${input('Y', 'y', selectedObject.position.y, 'position')}${input('Z', 'z', selectedObject.position.z, 'position')}</div></section>
                <section class="transform-section"><h3>ROTATION <span>DEG</span></h3><div class="transform-fields">${input('X', 'x', THREE.MathUtils.radToDeg(angles.x), 'rotation')}${input('Y', 'y', THREE.MathUtils.radToDeg(angles.y), 'rotation')}${input('Z', 'z', THREE.MathUtils.radToDeg(angles.z), 'rotation')}</div></section>
                <section class="transform-section"><h3>SCALE <span>LOCAL</span></h3><div class="transform-fields">${input('X', 'x', selectedObject.scale.x, 'scale')}${input('Y', 'y', selectedObject.scale.y, 'scale')}${input('Z', 'z', selectedObject.scale.z, 'scale')}</div></section>
                <div class="model-inspector-stats"><span class="inspector-label">SCENE STATISTICS</span><dl>
                  <dt>Meshes</dt><dd>${meshCount.toLocaleString()}</dd><dt>Triangles</dt><dd>${Math.floor(triangleCount).toLocaleString()}</dd><dt>Vertices</dt><dd>${vertexCount.toLocaleString()}</dd><dt>Materials</dt><dd>${materials.size.toLocaleString()}</dd>
                </dl></div>
                <p class="model-preview-note">Preview transforms are temporary and are not written to the archive.</p>`;
              target.querySelectorAll('[data-transform-axis]').forEach((field) => {
                field.addEventListener('change', () => {
                  const value = Number(field.value);
                  if (!Number.isFinite(value)) {
                    updateInspector();
                    return;
                  }
                  remember(snapshot(selectedObject));
                  const component = field.dataset.transformAxis;
                  selectedObject[field.dataset.transformType][component] =
                      field.dataset.transformType === 'rotation' ?
                      THREE.MathUtils.degToRad(value) : value;
                  selectedObject.updateMatrixWorld(true);
                  updateInspector();
                });
              });
            };
            const updateInspector = () => {
              if (scene) renderInspector();
            };
            transformControls.addEventListener('objectChange', updateInspector);
            const frameObject = (targetObject = model) => {
              const box = new THREE.Box3().setFromObject(targetObject);
              if (box.isEmpty()) return;
              const target = box.getCenter(new THREE.Vector3());
              const objectRadius = Math.max(box.getSize(new THREE.Vector3()).length() * .5, .01);
              const direction = camera.position.clone().sub(controls.target).normalize();
              if (!Number.isFinite(direction.length()) || direction.length() < .5)
                direction.set(1, .6, 1).normalize();
              controls.target.copy(target);
              camera.position.copy(target).add(direction.multiplyScalar(objectRadius * 2.8));
              controls.minDistance = objectRadius * .08;
              controls.maxDistance = objectRadius * 12;
              camera.near = Math.max(objectRadius / 10000, .001);
              camera.far = Math.max(objectRadius * 100, 100);
              camera.updateProjectionMatrix();
              controls.update();
            };
            const setView = (view) => {
              const direction = view === 'front' ? new THREE.Vector3(0, 0, 1) :
                  view === 'top' ? new THREE.Vector3(0, 1, 0) :
                                   new THREE.Vector3(1, 0, 0);
              const up = view === 'top' ? new THREE.Vector3(0, 0, -1) :
                                          new THREE.Vector3(0, 1, 0);
              controls.target.copy(center);
              camera.up.copy(up);
              camera.position.copy(center).add(direction.multiplyScalar(radius * 3.2));
              camera.lookAt(center);
              controls.update();
            };
            const toolbar = root.querySelector('.model-editor-toolbar');
            toolbar.addEventListener('click', (event) => {
              const button = event.target.closest('button');
              if (!button || button.disabled) return;
              if (button.dataset.editorMode) {
                mode = button.dataset.editorMode;
                toolbar.querySelectorAll('[data-editor-mode]').forEach((item) => {
                  const activeMode = item === button;
                  item.classList.toggle('is-active', activeMode);
                  item.setAttribute('aria-pressed', String(activeMode));
                });
                if (mode === 'select') transformControls.detach();
                else if (selectedObject) {
                  transformControls.attach(selectedObject);
                  transformControls.setMode(mode);
                }
              } else if (button.dataset.editorView) {
                setView(button.dataset.editorView);
              } else if (button.dataset.editorToggle) {
                const toggle = button.dataset.editorToggle;
                const next = button.getAttribute('aria-pressed') !== 'true';
                button.setAttribute('aria-pressed', String(next));
                button.classList.toggle('is-toggled', next);
                if (toggle === 'grid') grid.visible = next;
                if (toggle === 'axes') axes.visible = next;
                if (toggle === 'wireframe') {
                  wireframe = next;
                  for (const [material, original] of originalWireframe)
                    material.wireframe = next || original;
                }
              } else if (button.dataset.editorAction === 'frame') {
                frameObject(selectedObject || model);
              } else if (button.dataset.editorAction === 'reset-transform' &&
                  selectedObject) {
                const initial = initialTransforms.get(selectedObject);
                if (initial) {
                  remember(snapshot(selectedObject));
                  selectedObject.position.copy(initial.position);
                  selectedObject.rotation.copy(initial.rotation);
                  selectedObject.scale.copy(initial.scale);
                  selectedObject.updateMatrixWorld(true);
                  updateInspector();
                }
              } else if (button.dataset.editorAction === 'undo') {
                const previous = undoStack.pop();
                if (previous?.object) {
                  previous.object.position.copy(previous.position);
                  previous.object.rotation.copy(previous.rotation);
                  previous.object.scale.copy(previous.scale);
                  previous.object.updateMatrixWorld(true);
                  setUndoState();
                  updateInspector();
                }
              }
            });
            const outliner = root.querySelector('[data-model-outliner]');
            outliner.addEventListener('click', (event) => {
              const visibilityButton = event.target.closest('[data-outliner-visibility]');
              if (visibilityButton) {
                const entry = meshEntries[Number(visibilityButton.dataset.outlinerVisibility)];
                if (!entry) return;
                entry.object.visible = !entry.object.visible;
                if (entry.object === selectedObject && selectionHelper)
                  selectionHelper.visible = entry.object.visible;
                renderOutliner();
                return;
              }
              const selectButton = event.target.closest('[data-outliner-select]');
              if (selectButton)
                selectObject(meshEntries[Number(selectButton.dataset.outlinerSelect)]);
            });
            let pointerStart = null;
            canvas.addEventListener('pointerdown', (event) => {
              if (mode === 'select' && event.button === 0)
                pointerStart = {x: event.clientX, y: event.clientY};
            });
            canvas.addEventListener('pointerup', (event) => {
              if (!pointerStart || Math.hypot(
                  event.clientX - pointerStart.x,
                  event.clientY - pointerStart.y) > 4) {
                pointerStart = null;
                return;
              }
              pointerStart = null;
              const rect = canvas.getBoundingClientRect();
              const raycaster = new THREE.Raycaster();
              raycaster.setFromCamera(new THREE.Vector2(
                  ((event.clientX - rect.left) / rect.width) * 2 - 1,
                  -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
              const intersections = raycaster.intersectObjects(
                  meshEntries.map((entry) => entry.object), false);
              const picked = intersections[0]?.object;
              selectObject(meshEntries.find((entry) => entry.object === picked));
            });

            for (const entry of meshEntries)
              initialTransforms.set(entry.object, snapshot(entry.object));
            const resize = () => {
              if (!active || !renderer) return;
              const nextWidth = Math.max(canvas.clientWidth, 1);
              const nextHeight = Math.max(canvas.clientHeight, 1);
              camera.aspect = nextWidth / nextHeight;
              camera.updateProjectionMatrix();
              renderer.setSize(nextWidth, nextHeight, false);
            };
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(canvas.parentElement);
            const animate = () => {
              if (!active) return;
              animationFrame = requestAnimationFrame(animate);
              controls.update();
              selectionHelper?.update();
              renderer.render(scene, camera);
            };
            renderOutliner();
            renderInspector();
            empty.hidden = true;
            status.textContent =
                `${meshCount.toLocaleString()} meshes · ${Math.floor(triangleCount).toLocaleString()} triangles · ${payload.format.toUpperCase()}`;
            animate();
          } catch (renderError) {
            showError(
                `Could not render this model: ${renderError.message || renderError}`);
            cancelAnimationFrame(animationFrame);
            resizeObserver?.disconnect();
            controls?.dispose();
            transformControls?.dispose();
            renderer?.dispose();
            renderer?.forceContextLoss();
            disposeThreeObject(object);
            if (grid) disposeThreeObject(grid);
            if (axes) disposeThreeObject(axes);
            if (selectionHelper) disposeThreeObject(selectionHelper);
            controls = null;
            transformControls = null;
            renderer = null;
            grid = null;
            axes = null;
            selectionHelper = null;
            model = null;
          }
        };

        try {
          const bytes = decodeBase64(payload.data);
          if (payload.format === 'obj') {
            const source = new TextDecoder().decode(bytes);
            const materialAsset = (payload.assets || []).find(
                (asset) => asset.path.toLowerCase().endsWith('.mtl'));
            let materials = null;
            if (materialAsset)
              materials = new MTLLoader(manager).parse(
                  new TextDecoder().decode(decodeBase64(materialAsset.data)), '');
            materials?.preload();
            const loader = new OBJLoader(manager);
            if (materials) loader.setMaterials(materials);
            finish(loader.parse(source));
          } else if (payload.format === 'gltf' || payload.format === 'glb') {
            validateGltfPayload(payload.format, bytes);
            const input = payload.format === 'glb' ?
                bytes.buffer.slice(
                    bytes.byteOffset, bytes.byteOffset + bytes.byteLength) :
                new TextDecoder().decode(bytes);
            new GLTFLoader(manager).parse(
                input, '', (gltf) => finish(gltf.scene),
                (parseError) => showError(
                    `Could not decode this ${payload.format.toUpperCase()} model: ${parseError.message || parseError}`));
          } else {
            showError(`The ${payload.format || 'unknown'} model format is not supported.`);
          }
        } catch (loadError) {
          showError(`Could not decode this model: ${loadError.message || loadError}`);
        }
      })
      .catch((loadError) => showError(
          `Could not load the local 3D renderer: ${loadError.message || loadError}`));
  return dispose;
}

function disposeThreeObject(object) {
    object.traverse((child) => {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ?
          child.material :
          child.material ? [child.material] : [];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose();
        }
        if (material.uniforms) {
          for (const uniform of Object.values(material.uniforms)) {
            if (uniform.value?.isTexture) uniform.value.dispose();
          }
        }
        material.dispose();
      }
    });
  }
