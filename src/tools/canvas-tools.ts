/**
 * Canvas Tools
 *
 * MCP tool handler for canvas element inspection.
 * Detects canvas rendering libraries (Fabric.js, Konva, PixiJS, Phaser, Three.js, EaselJS),
 * queries their scene graphs for object metadata, and returns annotated screenshots.
 */

import { InspectCanvasInputSchema } from './tool-schemas.js';
import { captureScreenshot, getElementBoundingBox } from '../screenshot/index.js';
import type { CompositeResult, ImageResult, FileResult } from './tool-result.types.js';
import {
  getSessionManager,
  resolveExistingPage,
  ensureCdpSession,
  requireSnapshot,
  resolveElementByEid,
} from './tool-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single detected object on the canvas. */
export interface CanvasObject {
  type: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Result returned by the canvas detection script. */
export interface CanvasMetadata {
  library: string;
  objects: CanvasObject[];
  canvas_size: { w: number; h: number };
}

// ---------------------------------------------------------------------------
// Canvas detection script (executed in page context via Runtime.callFunctionOn)
// ---------------------------------------------------------------------------

/**
 * JavaScript function string executed via CDP Runtime.callFunctionOn with
 * `this` bound to the target canvas DOM element.
 *
 * Returns { library, objects[], canvas_size } describing detected library
 * and scene graph contents. Each library detector validates canvas ownership
 * to avoid false positives on multi-canvas pages.
 */
const CANVAS_DETECT_SCRIPT = `function() {
  var canvas = this;
  var MAX_OBJECTS = 50;
  var result = {
    library: 'none',
    objects: [],
    canvas_size: { w: canvas.width, h: canvas.height }
  };

  // -- Helpers --

  /** Safe constructor name: returns '' for minified names (length <= 2). */
  function safeName(obj) {
    var n = obj && obj.constructor && obj.constructor.name;
    return n && n.length > 2 ? n : '';
  }

  /** Scan window keys for first object matching predicate. */
  function scanWindow(pred) {
    var keys = Object.keys(window);
    for (var i = 0; i < keys.length; i++) {
      try { var v = window[keys[i]]; if (v && pred(v)) return v; } catch(e) {}
    }
    return null;
  }

  /** Collect up to max items into result.objects via an extractor function. */
  function collect(items, max, extract) {
    for (var i = 0; i < Math.min(items.length, max); i++) {
      result.objects.push(extract(items[i], i));
    }
  }

  try {
    // -- Fabric.js --
    var fc = null;
    if (typeof fabric !== 'undefined') {
      fc = canvas.__canvas || null;
      if (!fc && fabric.Canvas && fabric.Canvas.activeInstances) {
        fc = fabric.Canvas.activeInstances.find(function(c) {
          return c.lowerCanvasEl === canvas || c.upperCanvasEl === canvas;
        }) || null;
      }
    }
    if (!fc) {
      var canvasesToMatch = [canvas];
      if (canvas.classList) {
        if (canvas.classList.contains('upper-canvas') && canvas.previousElementSibling)
          canvasesToMatch.push(canvas.previousElementSibling);
        if (canvas.classList.contains('lower-canvas') && canvas.nextElementSibling)
          canvasesToMatch.push(canvas.nextElementSibling);
      }
      fc = scanWindow(function(obj) {
        if (typeof obj.getObjects !== 'function') return false;
        for (var ci = 0; ci < canvasesToMatch.length; ci++) {
          try {
            if (obj.lowerCanvasEl === canvasesToMatch[ci] || obj.upperCanvasEl === canvasesToMatch[ci])
              return true;
          } catch(e) {}
        }
        return false;
      });
    }
    if (fc && typeof fc.getObjects === 'function') {
      result.library = 'fabric';
      collect(fc.getObjects(), MAX_OBJECTS, function(o, i) {
        return {
          type: o.type || 'object',
          label: o.name || o.type || ('object-' + i),
          x: Math.round(o.left || 0), y: Math.round(o.top || 0),
          w: Math.round((o.width || 0) * (o.scaleX || 1)),
          h: Math.round((o.height || 0) * (o.scaleY || 1))
        };
      });
      return result;
    }
    if (canvas.classList && (canvas.classList.contains('lower-canvas') || canvas.classList.contains('upper-canvas'))) {
      result.library = 'fabric';
      return result;
    }

    // -- Konva --
    if (typeof Konva !== 'undefined' && Konva.stages) {
      var stage = Konva.stages.find(function(s) {
        var c = s.container(); return c && c.contains(canvas);
      });
      if (stage) {
        result.library = 'konva';
        collect(stage.find('Shape'), MAX_OBJECTS, function(s, i) {
          var cr = s.getClientRect();
          return {
            type: s.getClassName(),
            label: s.name() || s.getClassName() + '-' + i,
            x: Math.round(cr.x), y: Math.round(cr.y),
            w: Math.round(cr.width), h: Math.round(cr.height)
          };
        });
        return result;
      }
    }

    // -- PixiJS (canvas ownership: app.view / app.renderer.view / app.canvas) --
    if (typeof PIXI !== 'undefined') {
      var app = window.__PIXI_APP__ || window.app || scanWindow(function(obj) {
        return obj.renderer && obj.stage;
      });
      if (app && app.stage) {
        var pixiView = app.view || app.canvas || (app.renderer && (app.renderer.view || app.renderer.canvas));
        if (pixiView !== canvas) app = null;
      }
      if (app && app.stage) {
        result.library = 'pixi';
        collect(app.stage.children, MAX_OBJECTS, function(c, i) {
          var b = c.getBounds ? c.getBounds() : null;
          var t = safeName(c) || (c.isSprite ? 'Sprite' : 'DisplayObject');
          return {
            type: t, label: c.name || c.label || (t + '-' + i),
            x: b ? Math.round(b.x) : Math.round(c.x || 0),
            y: b ? Math.round(b.y) : Math.round(c.y || 0),
            w: b ? Math.round(b.width) : 0, h: b ? Math.round(b.height) : 0
          };
        });
        return result;
      }
    }

    // -- Phaser (canvas ownership: game.canvas) --
    if (typeof Phaser !== 'undefined' && window.game && window.game.canvas === canvas) {
      result.library = 'phaser';
      var scene = window.game.scene.getScenes(true)[0];
      if (scene) {
        collect(scene.children.getChildren(), MAX_OBJECTS, function(c, i) {
          return {
            type: c.type || 'gameObject',
            label: c.name || ((c.type || 'gameObject') + '-' + i),
            x: Math.round(c.x || 0), y: Math.round(c.y || 0),
            w: Math.round(c.displayWidth || c.width || 0),
            h: Math.round(c.displayHeight || c.height || 0)
          };
        });
      }
      return result;
    }

    // -- Three.js (canvas ownership: renderer.domElement) --
    if (typeof THREE !== 'undefined') {
      var threeScene = null;
      var rendererMatchesCanvas = false;
      var wkeys = Object.keys(window);
      for (var wi = 0; wi < wkeys.length; wi++) {
        try {
          var wobj = window[wkeys[wi]];
          if (wobj && typeof wobj === 'object') {
            if (wobj.domElement === canvas && typeof wobj.render === 'function')
              rendererMatchesCanvas = true;
            if (!threeScene && wobj.isScene && typeof wobj.traverse === 'function')
              threeScene = wobj;
          }
        } catch(e) {}
      }
      if (!threeScene && window.scene && typeof window.scene.traverse === 'function')
        threeScene = window.scene;
      if (rendererMatchesCanvas && threeScene) {
        result.library = 'three';
        var count = 0;
        threeScene.traverse(function(obj) {
          if (count >= MAX_OBJECTS) return;
          if (obj.isMesh || obj.isSprite) {
            result.objects.push({
              type: obj.type || 'mesh',
              label: obj.name || ((obj.type || 'mesh') + '-' + count),
              x: Math.round(obj.position.x), y: Math.round(obj.position.y),
              w: 0, h: 0
            });
            count++;
          }
        });
        return result;
      }
    }

    // -- EaselJS / ZIM (canvas ownership: stage.canvas) --
    if (typeof createjs !== 'undefined') {
      var easelStage = (typeof zim !== 'undefined' && zim.stage) || null;
      if (!easelStage) {
        easelStage = scanWindow(function(obj) {
          return obj instanceof createjs.Stage && obj.canvas === canvas;
        });
      }
      if (easelStage) {
        result.library = typeof zim !== 'undefined' ? 'zim' : 'easeljs';
        collect(easelStage.children, MAX_OBJECTS, function(c, i) {
          var b = c.getBounds ? c.getBounds() : null;
          var t = safeName(c) || (c.graphics ? 'Shape' : 'DisplayObject');
          return {
            type: t, label: c.name || ('object-' + i),
            x: Math.round(c.x || 0), y: Math.round(c.y || 0),
            w: b ? Math.round(b.width) : 0, h: b ? Math.round(b.height) : 0
          };
        });
        return result;
      }
    }
  } catch(e) {}

  return result;
}`;

// ---------------------------------------------------------------------------
// Canvas overlay script (executed in page context via Runtime.callFunctionOn)
// ---------------------------------------------------------------------------

/**
 * JavaScript function string that creates a temporary overlay canvas with
 * coordinate grid lines and object bounding boxes. Executed with `this` = canvas
 * element, arguments = [gridSpacing, objects[]].
 *
 * Uses position:fixed because getBoundingClientRect returns viewport-relative
 * coordinates.
 */
const CANVAS_OVERLAY_SCRIPT = `function(gridSpacing, objects) {
  var canvas = this;
  var rect = canvas.getBoundingClientRect();

  var overlay = document.createElement('canvas');
  overlay.id = '__inspect_canvas_overlay__';
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.cssText = [
    'position:fixed',
    'left:' + rect.left + 'px',
    'top:' + rect.top + 'px',
    'width:' + rect.width + 'px',
    'height:' + rect.height + 'px',
    'z-index:2147483647',
    'pointer-events:none'
  ].join(';');

  document.body.appendChild(overlay);
  var ctx = overlay.getContext('2d');

  // Coordinate grid (blue)
  ctx.strokeStyle = 'rgba(0, 100, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.font = '10px monospace';
  ctx.fillStyle = 'rgba(0, 100, 255, 0.6)';
  for (var x = 0; x <= canvas.width; x += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    ctx.fillText(String(x), x + 2, 10);
  }
  for (var y = 0; y <= canvas.height; y += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    ctx.fillText(String(y), 2, y - 2);
  }

  // Object bounding boxes (red)
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
  ctx.font = '11px monospace';
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i];
    if (obj.w > 0 && obj.h > 0) ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    ctx.fillText(obj.label, obj.x + 2, obj.y - 3);
  }

  return overlay.id;
}`;

// ---------------------------------------------------------------------------
// Overlay cleanup helper
// ---------------------------------------------------------------------------

const OVERLAY_ID = '__inspect_canvas_overlay__';

/**
 * Remove overlay and release CDP object reference. Best-effort, never throws.
 */
async function cleanupInspection(
  cdp: { send: (method: string, params?: unknown) => Promise<unknown> },
  objectId?: string
): Promise<void> {
  await cdp
    .send('Runtime.evaluate', {
      expression: `document.getElementById('${OVERLAY_ID}')?.remove()`,
      returnByValue: true,
    })
    .catch(() => { /* best-effort cleanup */ });

  if (objectId) {
    await cdp.send('Runtime.releaseObject', { objectId }).catch(() => { /* best-effort cleanup */ });
  }
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

/**
 * Inspect a canvas element: detect library, query scene graph, and return
 * an annotated screenshot with coordinate grid + object bounding boxes.
 */
export async function inspectCanvas(rawInput: unknown): Promise<CompositeResult> {
  const input = InspectCanvasInputSchema.parse(rawInput);

  const session = getSessionManager();
  let handle = resolveExistingPage(session, input.page_id);
  const pageId = handle.page_id;

  const ensureResult = await ensureCdpSession(session, handle);
  handle = ensureResult.handle;

  const snapshot = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snapshot);

  // Scroll canvas into view before computing bounding box and overlay
  await handle.cdp.send('DOM.scrollIntoViewIfNeeded', {
    backendNodeId: node.backend_node_id,
  });

  // Parallelize independent CDP calls
  const [clip, { object }] = await Promise.all([
    getElementBoundingBox(handle.cdp, node.backend_node_id),
    handle.cdp.send('DOM.resolveNode', { backendNodeId: node.backend_node_id }),
  ]);

  // Detect canvas library and query scene graph
  const detectResult = await handle.cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: CANVAS_DETECT_SCRIPT,
    returnByValue: true,
    awaitPromise: false,
  });

  const metadata: CanvasMetadata = (detectResult.result.value as CanvasMetadata) ?? {
    library: 'none',
    objects: [],
    canvas_size: { w: clip.width, h: clip.height },
  };

  const gridSpacing = input.grid_spacing ?? 50;

  // Create overlay with grid and object bounding boxes
  await handle.cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: CANVAS_OVERLAY_SCRIPT,
    arguments: [{ value: gridSpacing }, { value: metadata.objects as unknown }],
    returnByValue: true,
    awaitPromise: false,
  });

  // Capture screenshot with overlay, always clean up overlay + release objectId
  let screenshotResult: ImageResult | FileResult;
  try {
    screenshotResult = await captureScreenshot(handle.cdp, {
      format: input.format ?? 'png',
      quality: input.quality,
      clip,
    });
  } finally {
    await cleanupInspection(handle.cdp, object.objectId);
  }

  return { type: 'composite', text: JSON.stringify(metadata), image: screenshotResult };
}
