import React, { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Simulation, generateId, Vector2, Body } from "../lib/Simulation";
import {
  ToolMode,
  AddMode,
  BodyPreset,
  VisualSettings,
  ActivePopUp,
} from "../App";
import {
  MousePointer2,
  CircleDot,
  Play,
  Pause,
  FastForward,
  Undo2,
  MousePointerClick,
  Sparkles,
  Plus,
  Settings,
  ZoomIn,
  ZoomOut,
  Maximize,
  Ruler,
} from "lucide-react";

// Disable PIXI's buggy static ResizePlugin as we handle resizing manually in the ticker
PIXI.extensions.remove(PIXI.ResizePlugin);

interface CanvasViewProps {
  sim: Simulation;
  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;
  addMode: AddMode;
  creationPreset: BodyPreset;
  onSelectBody: (id: string | null) => void;
  selectedBodyId: string | null;
  visualSettings: VisualSettings;
  setActivePopUp: (val: ActivePopUp) => void;
}
const generateCirclePoints = (
  x: number,
  y: number,
  radius: number,
  segments: number,
) => {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(x + Math.cos(angle) * radius);
    points.push(y + Math.sin(angle) * radius);
  }
  return points;
};

const vertexShader = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreenPos;
out vec2 vFilterPos;
out vec2 vFilterSize;
out vec2 vUvScale;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vScreenPos = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    vFilterPos = uOutputFrame.xy;
    vFilterSize = uOutputFrame.zw;
    vUvScale = uInputSize.zw;
}
`;

const fragmentShader = `
in vec2 vTextureCoord;
in vec2 vScreenPos;
in vec2 vFilterPos;
in vec2 vFilterSize;
in vec2 vUvScale;

uniform sampler2D uTexture;
uniform vec4 uBlackHoles[10]; // x, y, radius, isBlackHole
uniform vec4 uLenseMasses[10]; 
uniform int uBlackHoleCount;
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uResolution; // Logical CSS dimensions

out vec4 finalColor;

void main() {
    // Pixi abstracts custom filter mappings to Logical CSS pixels automatically across retina screen sizes
    vec2 logicalScreenPos = vScreenPos; 
    
    // 2. Convert logical pixel to physical world coordinate
    vec2 worldPos = (logicalScreenPos - uResolution * 0.5) / uZoom + uCamera;
    vec2 warpedWorldPos = worldPos;
    
    for (int i = 0; i < 10; i++) {
        if (i >= uBlackHoleCount) break;
        
        vec2 bhPos = uBlackHoles[i].xy;
        float radius = uBlackHoles[i].z;
        float isBlackHole = uBlackHoles[i].w;
        float mass = uLenseMasses[i].x;
        
        vec2 diff = worldPos - bhPos;
        float dist = length(diff);
        
        if (dist <= radius && isBlackHole > 0.5) {
            finalColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }

        // Apply deformation only OUTSIDE the physical radius for normal bodies (stars/planets)
        // Black holes warp space intensely up to the event horizon edge
        if (isBlackHole > 0.5 || dist > radius) {
            // FIX: Normal bodies warp based strictly on MASS.
            // Previously, radius^2 was artificially bloating the warp field of large stars.
            float warpStrength = isBlackHole > 0.5 ? ((mass / 20.0) + (radius * radius * 0.5)) : (mass / 15.0);
            
            // For normal bodies, deformation falls off from the surface edge
            // For black holes, the effective distance approaches the singularity
            float effectiveDistSq = isBlackHole > 0.5 ? max(dist * dist, 1.0) : max(dist * dist, pow(radius + 1.0, 2.0));
            
            float deformation = warpStrength / effectiveDistSq;
            warpedWorldPos -= diff * min(deformation, 1.0);
        }
    }
    
    // 3. Calculate exactly how far the spacetime bent in WORLD distance
    vec2 worldOffset = warpedWorldPos - worldPos;
    
    // 4. Convert that world shift into a Logical Pixel shift
    vec2 logicalPixelOffset = worldOffset * uZoom;
    
    // 5. Convert Logical Pixel shift into normalized UV coordinate offset (0.0 to 1.0)
    // vUvScale is perfectly mapped to logical texture plane, so no DPR scalar applied! (Resolves the 2x scale bloat bug)
    vec2 uvOffset = logicalPixelOffset * vUvScale;
    
    vec2 warpedUV = vTextureCoord + uvOffset;
    
    if (warpedUV.x < 0.0 || warpedUV.x > 1.0 || warpedUV.y < 0.0 || warpedUV.y > 1.0) {
        finalColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    finalColor = texture(uTexture, warpedUV);
}
`;

export const CanvasView: React.FC<CanvasViewProps> = ({
  sim,
  toolMode,
  setToolMode,
  addMode,
  creationPreset,
  onSelectBody,
  selectedBodyId,
  visualSettings,
  setActivePopUp,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(visualSettings);

  // Sync settings ref
  useEffect(() => {
    settingsRef.current = visualSettings;
  }, [visualSettings]);

  // State for interaction logic
  const interactionState = useRef<{
    isDraggingVector: boolean;
    dragStartWorldPos: Vector2 | null;
    isPanning: boolean;
    panStartScreenPos: Vector2 | null;
    panStartCamera: Vector2 | null;
    lastPanScreenPos: Vector2 | null;
    panVelocity: Vector2;
    hasMomentum: boolean;
    activePointers: Map<number, Vector2>;
    lastPinchDist: number | null;
    lastPinchMidpoint: Vector2 | null;
    orbitParentId: string | null;
    hoveredBodyId: string | null;
  }>({
    isDraggingVector: false,
    dragStartWorldPos: null,
    isPanning: false,
    panStartScreenPos: null,
    panStartCamera: null,
    lastPanScreenPos: null,
    panVelocity: { x: 0, y: 0 },
    hasMomentum: false,
    activePointers: new Map(),
    lastPinchDist: null,
    lastPinchMidpoint: null,
    orbitParentId: null,
    hoveredBodyId: null,
  });

  // Sync selectedBodyId back to sim so drawing knows
  useEffect(() => {
    sim.selectedBodyId = selectedBodyId;
  }, [sim, selectedBodyId]);

  // Reset interaction state on tool change
  useEffect(() => {
    const iState = interactionState.current;
    iState.isDraggingVector = false;
    iState.dragStartWorldPos = null;
    iState.orbitParentId = null;
    sim.previewBody = null;
    sim.previewVelocityVector = null;
    sim.orbitPreview = null;
    sim.rulerStartPoint = null;
  }, [toolMode, sim]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      const iState = interactionState.current;
      iState.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      container.setPointerCapture(e.pointerId);

      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = sim.screenToWorld(
        sx,
        sy,
        container.clientWidth,
        container.clientHeight,
      );

      sim.mouseWorldPos = wx;

      if (toolMode === "ruler") {
        sim.rulerStartPoint = wx;
        return;
      }

      // Middle click or right click -> pan
      if (
        e.button === 1 ||
        e.button === 2 ||
        (e.button === 0 && toolMode === "select")
      ) {
        // Did we click a body?
        let clickedBodyId: string | null = null;
        for (let i = sim.bodies.length - 1; i >= 0; i--) {
          const b = sim.bodies[i];
          const distSq =
            (b.position.x - wx.x) ** 2 + (b.position.y - wx.y) ** 2;
          if (distSq <= Math.max(b.radius, 10 / sim.camera.zoom) ** 2) {
            clickedBodyId = b.id;
            break;
          }
        }

        if (e.button === 0 && toolMode === "select") {
          onSelectBody(clickedBodyId);
          if (clickedBodyId) return;
        }

        // Start pan
        iState.isPanning = true;
        iState.hasMomentum = false;
        iState.panVelocity = { x: 0, y: 0 };
        iState.panStartScreenPos = { x: sx, y: sy };
        iState.lastPanScreenPos = { x: sx, y: sy };
        iState.panStartCamera = { x: sim.camera.x, y: sim.camera.y };
        return;
      }

      if (e.button !== 0) return;

      if (toolMode === "add") {
        const isVehicle =
          sim.creationTemplate.presetType === "rocket" ||
          sim.creationTemplate.presetType === "heatProtectedRocket";

        if (addMode === "static") {
          const meta = sim.getBodyMetadataFromPreset();
          const id = generateId();

          let spawnPos = wx;
          let spawnRotation = -Math.PI / 2; // Default up

          // Check for surface snap
          let parentBody = null;
          for (const b of sim.bodies) {
            const dx = wx.x - b.position.x;
            const dy = wx.y - b.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // If near surface (within 2x radius for example)
            if (dist < b.radius * 2 && b.mass > 0 && !sim.isBodyBlackHole(b)) {
              const nx = dx / dist;
              const ny = dy / dist;
              spawnPos = {
                x: b.position.x + nx * (b.radius + meta.radius),
                y: b.position.y + ny * (b.radius + meta.radius),
              };
              spawnRotation = Math.atan2(ny, nx);
              parentBody = b;
              break;
            }
          }

          const newBody: Body = {
            id,
            ...meta,
            position: spawnPos,
            velocity: parentBody ? { ...parentBody.velocity } : { x: 0, y: 0 },
            trail: [],
          };

          if (isVehicle) {
            // Remove old vehicle if exists
            if (sim.vehicle) {
              sim.bodies = sim.bodies.filter((b) => b.id !== sim.vehicle?.id);
            }

            const v: any = {
              ...newBody,
              velocity: { ...newBody.velocity }, // Force inheritance
              parentBodyId: parentBody ? parentBody.id : null,
              relativeOffset: parentBody
                ? {
                    x: newBody.position.x - parentBody.position.x,
                    y: newBody.position.y - parentBody.position.y,
                  }
                : null,
              type: sim.creationTemplate.presetType as any,
              rotation: spawnRotation,
              angularVelocity: 0,
              isHeatProtected:
                sim.creationTemplate.presetType === "heatProtectedRocket",
              thrustPower: meta.thrustPower || 0.000001,
              size: meta.radius,
              maxKineticEnergy: meta.maxKineticEnergy || 1000,
            };
            sim.vehicle = v;
            sim.camera.followingId = id;
            sim.bodies.push(v);
            setToolMode("select");
            setActivePopUp(null);
          } else {
            sim.bodies.push(newBody);
          }
        } else if (addMode === "velocity") {
          iState.isDraggingVector = true;
          iState.dragStartWorldPos = wx;
        } else if (addMode === "orbit") {
          if (!iState.orbitParentId) {
            let clickedBodyId: string | null = null;
            for (let i = sim.bodies.length - 1; i >= 0; i--) {
              const b = sim.bodies[i];
              const distSq =
                (b.position.x - wx.x) ** 2 + (b.position.y - wx.y) ** 2;
              if (distSq <= Math.max(b.radius, 10 / sim.camera.zoom) ** 2) {
                clickedBodyId = b.id;
                break;
              }
            }
            if (clickedBodyId) {
              iState.orbitParentId = clickedBodyId;
              sim.orbitPreview = { parentId: clickedBodyId, mousePos: wx };
            }
          } else {
            const parent = sim.bodies.find(
              (b) => b.id === iState.orbitParentId,
            );
            if (parent) {
              const dx = wx.x - parent.position.x;
              const dy = wx.y - parent.position.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 0.1) {
                let vMag = 0;
                if (sim.isBodyBlackHole(parent)) {
                  const innerDist = Math.max(0.1, dist - parent.radius);
                  vMag = Math.sqrt(sim.G * parent.mass * dist) / innerDist;
                } else {
                  vMag = Math.sqrt((sim.G * parent.mass) / dist);
                }
                const nx = -dy / dist;
                const ny = dx / dist;
                const vOrbitX = nx * vMag;
                const vOrbitY = ny * vMag;

                const meta = sim.getBodyMetadataFromPreset();
                const id = generateId();
                const newBody: Body = {
                  id,
                  ...meta,
                  position: wx,
                  velocity: {
                    x: parent.velocity.x + vOrbitX,
                    y: parent.velocity.y + vOrbitY,
                  },
                  trail: [],
                };

                if (isVehicle) {
                  // Remove old vehicle if exists
                  if (sim.vehicle) {
                    sim.bodies = sim.bodies.filter(
                      (b) => b.id !== sim.vehicle?.id,
                    );
                  }

                  const v: any = {
                    ...newBody,
                    type: sim.creationTemplate.presetType as any,
                    rotation: Math.atan2(vOrbitY, vOrbitX),
                    angularVelocity: 0,
                    isHeatProtected:
                      sim.creationTemplate.presetType === "heatProtectedRocket",
                    thrustPower: meta.thrustPower || 5,
                    size: meta.radius,
                    maxKineticEnergy: meta.maxKineticEnergy || 1000,
                  };
                  sim.vehicle = v;
                  sim.camera.followingId = id;
                  sim.bodies.push(v);
                  setToolMode("select");
                  setActivePopUp(null);
                } else {
                  sim.bodies.push(newBody);
                }
              }
            }
            iState.orbitParentId = null;
            sim.orbitPreview = null;
          }
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // We must use clientWidth/clientHeight instead of canvas.width for proper scaling with Pixi
      const wx = sim.screenToWorld(
        sx,
        sy,
        container.clientWidth,
        container.clientHeight,
      );
      const iState = interactionState.current;

      iState.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Handle pinch zoom init
      if (
        toolMode === "select" &&
        iState.activePointers.size === 2 &&
        iState.lastPinchDist === null
      ) {
        iState.isPanning = false; // Disable single-finger panning when starting a pinch
        const points = Array.from(iState.activePointers.values()) as Vector2[];
        const dist = Math.sqrt(
          (points[0].x - points[1].x) ** 2 + (points[0].y - points[1].y) ** 2,
        );
        iState.lastPinchDist = dist;
        iState.lastPinchMidpoint = {
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
        };
      }

      // Determine hovered body
      let hoveredId: string | null = null;
      for (let i = sim.bodies.length - 1; i >= 0; i--) {
        const b = sim.bodies[i];
        const distSq = (b.position.x - wx.x) ** 2 + (b.position.y - wx.y) ** 2;
        if (distSq <= Math.max(b.radius, 10 / sim.camera.zoom) ** 2) {
          hoveredId = b.id;
          break;
        }
      }
      iState.hoveredBodyId = hoveredId;
      sim.mouseWorldPos = wx;

      // multi-touch zoom & pan (Inertia free)
      if (
        toolMode === "select" &&
        iState.activePointers.size === 2 &&
        iState.lastPinchDist !== null &&
        iState.lastPinchMidpoint
      ) {
        const points = Array.from(iState.activePointers.values()) as Vector2[];
        const dist = Math.sqrt(
          (points[0].x - points[1].x) ** 2 + (points[0].y - points[1].y) ** 2,
        );
        const midX = (points[0].x + points[1].x) / 2;
        const midY = (points[0].y + points[1].y) / 2;

        sim.camera.followingId = null;

        // 1. Handle simultaneous panning (translation)
        const dx = midX - iState.lastPinchMidpoint.x;
        const dy = midY - iState.lastPinchMidpoint.y;
        sim.camera.x -= dx / sim.camera.zoom;
        sim.camera.y -= dy / sim.camera.zoom;
        iState.lastPinchMidpoint = { x: midX, y: midY };

        // 2. Handle Zoom
        if (Math.abs(dist - iState.lastPinchDist) > 0.1) {
          const zoomFactor = dist / iState.lastPinchDist;
          const oldZoom = sim.camera.zoom;
          let newZoom = oldZoom * zoomFactor;
          newZoom = Math.max(1e-15, Math.min(newZoom, 1e15));

          // Zoom toward center of pinch (the current midX, midY)
          const worldPinch = sim.screenToWorld(
            midX - rect.left,
            midY - rect.top,
            container.clientWidth,
            container.clientHeight,
          );

          sim.camera.zoom = newZoom;
          // Adjust camera to keep worldPinch point static under user fingers
          sim.camera.x =
            worldPinch.x - (worldPinch.x - sim.camera.x) * (oldZoom / newZoom);
          sim.camera.y =
            worldPinch.y - (worldPinch.y - sim.camera.y) * (oldZoom / newZoom);

          iState.lastPinchDist = dist;
        }
        return;
      }

      if (
        iState.isPanning &&
        iState.panStartScreenPos &&
        iState.panStartCamera &&
        iState.lastPanScreenPos
      ) {
        sim.camera.followingId = null; // stop following on manual pan
        const dxScreen = sx - iState.panStartScreenPos.x;
        const dyScreen = sy - iState.panStartScreenPos.y;

        sim.camera.x = iState.panStartCamera.x - dxScreen / sim.camera.zoom;
        sim.camera.y = iState.panStartCamera.y - dyScreen / sim.camera.zoom;

        // Velocity tracking for momentum
        const vx = (sx - iState.lastPanScreenPos.x) / sim.camera.zoom;
        const vy = (sy - iState.lastPanScreenPos.y) / sim.camera.zoom;

        // Exponential smoothing for velocity tracking
        iState.panVelocity.x = iState.panVelocity.x * 0.7 + vx * 0.3;
        iState.panVelocity.y = iState.panVelocity.y * 0.7 + vy * 0.3;

        iState.lastPanScreenPos = { x: sx, y: sy };
      }

      if (iState.isDraggingVector && iState.dragStartWorldPos) {
        sim.previewBody = null; // Ensure preview body doesn't conflict
        sim.previewVelocityVector = {
          start: iState.dragStartWorldPos,
          end: wx,
        };
      }

      if (toolMode === "add" && addMode === "orbit" && iState.orbitParentId) {
        sim.orbitPreview = {
          parentId: iState.orbitParentId,
          mousePos: wx,
        };
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const iState = interactionState.current;
      iState.activePointers.delete(e.pointerId);
      if (iState.activePointers.size < 2) {
        iState.lastPinchDist = null;
        iState.lastPinchMidpoint = null;
      }

      if (iState.isPanning) {
        iState.isPanning = false;
        // Check if velocity is high enough to trigger momentum
        const speedSq = iState.panVelocity.x ** 2 + iState.panVelocity.y ** 2;
        if (speedSq > 0.1) {
          iState.hasMomentum = true;
        }
      }

      if (iState.isDraggingVector && iState.dragStartWorldPos) {
        const rect = container.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const wx = sim.screenToWorld(
          sx,
          sy,
          container.clientWidth,
          container.clientHeight,
        );

        // velocity scalar
        const vx = (wx.x - iState.dragStartWorldPos.x) * 0.5; // multiplier
        const vy = (wx.y - iState.dragStartWorldPos.y) * 0.5;

        const isVehicle =
          sim.creationTemplate.presetType === "rocket" ||
          sim.creationTemplate.presetType === "heatProtectedRocket";
        const meta = sim.getBodyMetadataFromPreset();
        const id = generateId();
        const newBody: Body = {
          id,
          ...meta,
          position: { ...iState.dragStartWorldPos },
          velocity: { x: vx, y: vy },
          trail: [],
        };

        if (isVehicle) {
          // Remove old vehicle if exists
          if (sim.vehicle) {
            sim.bodies = sim.bodies.filter((b) => b.id !== sim.vehicle?.id);
          }

          const v: any = {
            ...newBody,
            type: sim.creationTemplate.presetType as any,
            rotation: Math.atan2(vy, vx),
            angularVelocity: 0,
            isHeatProtected:
              sim.creationTemplate.presetType === "heatProtectedRocket",
            thrustPower: meta.thrustPower || 5,
            size: meta.radius,
            maxKineticEnergy: meta.maxKineticEnergy || 1000,
          };
          sim.vehicle = v;
          sim.camera.followingId = id;
          sim.bodies.push(v);
          setToolMode("select");
          setActivePopUp(null);
        } else {
          sim.bodies.push(newBody);
        }

        iState.isDraggingVector = false;
        iState.dragStartWorldPos = null;
        sim.previewVelocityVector = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const zoomSpeed = 0.001;
      let newZoom = sim.camera.zoom * Math.exp(-e.deltaY * zoomSpeed);
      newZoom = Math.max(1e-15, Math.min(newZoom, 1e15)); // Relaxed zoom clamp
      sim.camera.zoom = newZoom;
    };

    const onDblClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = sim.screenToWorld(
        sx,
        sy,
        container.clientWidth,
        container.clientHeight,
      );

      let clickedId: string | null = null;
      for (let i = sim.bodies.length - 1; i >= 0; i--) {
        const b = sim.bodies[i];
        const distSq = (b.position.x - wx.x) ** 2 + (b.position.y - wx.y) ** 2;
        if (distSq <= Math.max(b.radius, 10 / sim.camera.zoom) ** 2) {
          clickedId = b.id;
          break;
        }
      }
      sim.camera.followingId = clickedId;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in a text field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (!sim.vehicle) return;
      const v: any = sim.vehicle;
      if (e.key.toLowerCase() === "w") {
        v.thrusting = true;
        v.parentBodyId = null; // Break binding on launch
      }
      if (e.key.toLowerCase() === "a") v.rotatingLeft = true;
      if (e.key.toLowerCase() === "d") v.rotatingRight = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Ignore if typing in a text field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (!sim.vehicle) return;
      const v: any = sim.vehicle;
      if (e.key.toLowerCase() === "w") v.thrusting = false;
      if (e.key.toLowerCase() === "a") v.rotatingLeft = false;
      if (e.key.toLowerCase() === "d") v.rotatingRight = false;
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("dblclick", onDblClick);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", (e) => e.preventDefault());
    };
  }, [sim, toolMode, addMode, creationPreset, onSelectBody]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDestroyed = false;
    let app: PIXI.Application | null = null;
    let lastTime = performance.now();
    let textCache = new Map<string, PIXI.Text>();

    const initPixi = async () => {
      app = new PIXI.Application();
      const pixelRatio = window.devicePixelRatio || 1;
      await app.init({
        resizeTo: container,
        backgroundAlpha: 0,
        antialias: true,
        resolution: pixelRatio,
        autoDensity: true,
      });

      if (isDestroyed) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }

      container.appendChild(app.canvas);

      const bgFilteredLayer = new PIXI.Container();
      const fgFilteredLayer = new PIXI.Container();
      const unfilteredLayer = new PIXI.Container();
      app.stage.addChild(bgFilteredLayer, fgFilteredLayer, unfilteredLayer);

      const bhProgram = PIXI.GlProgram.from({
        vertex: vertexShader,
        fragment: fragmentShader,
      });

      const createFilter = () =>
        new PIXI.Filter({
          glProgram: bhProgram,
          resources: {
            bhUniforms: {
              uBlackHoles: {
                value: new Float32Array(4 * 10),
                type: "vec4<f32>",
                size: 10,
              },
              uLenseMasses: {
                value: new Float32Array(4 * 10),
                type: "vec4<f32>",
                size: 10,
              },
              uBlackHoleCount: { value: 0, type: "i32" },
              uCamera: { value: new Float32Array(2), type: "vec2<f32>" },
              uZoom: { value: 1.0, type: "f32" },
              uResolution: { value: new Float32Array(2), type: "vec2<f32>" },
            },
          },
        });

      const bgFilter = createFilter();
      const fgFilter = createFilter();

      bgFilteredLayer.filters = [bgFilter];
      fgFilteredLayer.filters = [fgFilter];

      // Create a star texture for TilingSprites
      const createStarTexture = (size: number, density: number) => {
        const graphics = new PIXI.Graphics();
        for (let i = 0; i < density; i++) {
          const x = Math.random() * size;
          const y = Math.random() * size;
          // Slightly coarser stars for better static visibility
          const r = Math.random() * 0.8 + 0.2;
          const alpha = 0.2 + Math.random() * 0.4;
          graphics.circle(x, y, r).fill({ color: "#ffffff", alpha });
        }
        return app!.renderer.generateTexture(graphics);
      };

      const starTexture1 = createStarTexture(1024, 120); // Static backdrop

      const starsLayer = new PIXI.Container();
      const starLayer = new PIXI.TilingSprite({
        texture: starTexture1,
        width: 2000,
        height: 2000,
      });
      starsLayer.addChild(starLayer);

      const gridGraphics = new PIXI.Graphics();
      const worldBgContainer = new PIXI.Container();
      const worldFgContainer = new PIXI.Container();

      const backgroundTrailsGraphics = new PIXI.Graphics();
      const bodiesGraphics = new PIXI.Graphics();
      const foregroundTrailsGraphics = new PIXI.Graphics();
      const foregroundBodiesGraphics = new PIXI.Graphics();

      const labelsContainer = new PIXI.Container();
      const uiGraphics = new PIXI.Graphics();

      bgFilteredLayer.addChild(starsLayer, gridGraphics, worldBgContainer);
      fgFilteredLayer.addChild(worldFgContainer);
      unfilteredLayer.addChild(labelsContainer, uiGraphics);

      worldBgContainer.addChild(backgroundTrailsGraphics, bodiesGraphics);
      worldFgContainer.addChild(
        foregroundTrailsGraphics,
        foregroundBodiesGraphics,
      );

      app.ticker.add(() => {
        if (isDestroyed) return;

        // Sync settings
        bgFilter.enabled = settingsRef.current.warpEnabled;
        fgFilter.enabled = settingsRef.current.warpEnabled;
        gridGraphics.visible = settingsRef.current.gridEnabled;
        starsLayer.visible = settingsRef.current.starsEnabled;
        backgroundTrailsGraphics.visible = settingsRef.current.trailsEnabled;
        foregroundTrailsGraphics.visible = settingsRef.current.trailsEnabled;

        const time = performance.now();
        const dt = (time - lastTime) / 1000;
        lastTime = time;

        const pixelRatio = window.devicePixelRatio || 1;
        if (
          app!.renderer.width !== container.clientWidth * pixelRatio ||
          app!.renderer.height !== container.clientHeight * pixelRatio
        ) {
          app!.renderer.resize(container.clientWidth, container.clientHeight);
        }

        // Lock filterArea to screen dimensions so Pixi doesn't dynamically crop the shader texture bounds
        bgFilteredLayer.filterArea = app!.screen;
        fgFilteredLayer.filterArea = app!.screen;

        sim.update(dt);

        // Apply Momentum Pan
        const iState = interactionState.current;
        if (
          iState.hasMomentum &&
          !iState.isPanning &&
          !sim.camera.followingId
        ) {
          sim.camera.x -= iState.panVelocity.x;
          sim.camera.y -= iState.panVelocity.y;

          // Apply friction damping
          iState.panVelocity.x *= 0.94;
          iState.panVelocity.y *= 0.94;

          if (
            Math.abs(iState.panVelocity.x) < 0.01 &&
            Math.abs(iState.panVelocity.y) < 0.01
          ) {
            iState.hasMomentum = false;
            iState.panVelocity = { x: 0, y: 0 };
          }
        }

        // Logical pixels (CSS dimensions)
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Background Lenses: ONLY BLACK HOLES AND STARS (by label)
        const bgLenses = [...sim.bodies]
          .filter((b) => sim.isStar(b) || sim.isBodyBlackHole(b))
          .sort((a, b) => b.mass - a.mass)
          .slice(0, 10);

        // Foreground Lenses: ONLY BLACK HOLES
        const fgLenses = bgLenses.filter((b) => sim.isBodyBlackHole(b));

        const applyLenses = (filter: PIXI.Filter, lensesToApply: Body[]) => {
          const uniforms = filter.resources.bhUniforms.uniforms;
          uniforms.uBlackHoleCount = Math.min(lensesToApply.length, 10);
          for (let i = 0; i < uniforms.uBlackHoleCount; i++) {
            // Pass relative coordinates to shader to avoid jitter
            uniforms.uBlackHoles[i * 4] =
              lensesToApply[i].position.x - sim.camera.x;
            uniforms.uBlackHoles[i * 4 + 1] =
              lensesToApply[i].position.y - sim.camera.y;
            uniforms.uBlackHoles[i * 4 + 2] = lensesToApply[i].radius;
            uniforms.uBlackHoles[i * 4 + 3] = sim.isBodyBlackHole(
              lensesToApply[i],
            )
              ? 1.0
              : 0.0;
            uniforms.uLenseMasses[i * 4] = lensesToApply[i].mass;
          }
          // In relative mode, camera is effectively at 0,0 for the shader
          uniforms.uCamera[0] = 0;
          uniforms.uCamera[1] = 0;
          uniforms.uZoom = sim.camera.zoom;
          uniforms.uResolution[0] = width;
          uniforms.uResolution[1] = height;
        };

        applyLenses(bgFilter, bgLenses);
        applyLenses(fgFilter, fgLenses);

        bgFilter.enabled =
          settingsRef.current.warpEnabled && bgLenses.length > 0;
        fgFilter.enabled =
          settingsRef.current.warpEnabled && fgLenses.length > 0;

        const cx = sim.camera.x;
        const cy = sim.camera.y;
        const zoom = sim.camera.zoom;

        // Static stars: just match screen size
        starLayer.width = width;
        starLayer.height = height;
        starLayer.position.set(0, 0);
        starLayer.tilePosition.set(0, 0);
        starLayer.tileScale.set(1);

        // Grid
        gridGraphics.clear();
        const gridSize = 100 * zoom;

        if (gridSize >= 15) {
          const offsetX = (width / 2 - sim.camera.x * zoom) % gridSize;
          const offsetY = (height / 2 - sim.camera.y * zoom) % gridSize;

          for (let x = offsetX; x < width; x += gridSize) {
            gridGraphics.moveTo(x, 0).lineTo(x, height);
          }
          for (let y = offsetY; y < height; y += gridSize) {
            gridGraphics.moveTo(0, y).lineTo(width, y);
          }
          gridGraphics.stroke({ width: 1, color: "#ffffff", alpha: 0.05 });
        }

        // Transform: Using floating origin to prevent jitter
        // Container is centered, drawn objects use (pos - camera)
        worldBgContainer.position.set(width / 2, height / 2);
        worldBgContainer.scale.set(zoom);
        worldBgContainer.pivot.set(0, 0);

        worldFgContainer.position.copyFrom(worldBgContainer.position);
        worldFgContainer.scale.copyFrom(worldBgContainer.scale);
        worldFgContainer.pivot.copyFrom(worldBgContainer.pivot);

        backgroundTrailsGraphics.clear();
        foregroundTrailsGraphics.clear();
        bodiesGraphics.clear();
        foregroundBodiesGraphics.clear();

        const activeLabels = new Set<string>();
        const responsiveStrokeWidth = 1 / zoom; // Scales perfectly with zoom
        const trailWidth = 1 / zoom;

        // Sort all bodies
        const sortedBodies = [...sim.bodies].sort((a, b) => {
          const aIsBH = sim.isBodyBlackHole(a);
          const bIsBH = sim.isBodyBlackHole(b);
          if (aIsBH && !bIsBH) return 1;
          if (!aIsBH && bIsBH) return -1;
          return a.radius - b.radius;
        });

        for (const b of sortedBodies) {
          const isLense = bgLenses.includes(b);
          const targetGraphics = isLense
            ? foregroundBodiesGraphics
            : bodiesGraphics;
          const targetTrailsGraphics = isLense
            ? foregroundTrailsGraphics
            : backgroundTrailsGraphics;

          // Trails (Relative)
          if (b.trail && b.trail.length > 0) {
            const len = b.trail.length;
            for (let i = 0; i < len - 1; i++) {
              const alpha = 0.4 * (i / len);
              targetTrailsGraphics.moveTo(b.trail[i].x - cx, b.trail[i].y - cy);
              targetTrailsGraphics.lineTo(
                b.trail[i + 1].x - cx,
                b.trail[i + 1].y - cy,
              );
              targetTrailsGraphics.stroke({
                width: trailWidth,
                color: b.color,
                alpha,
              });
            }
            targetTrailsGraphics.moveTo(
              b.trail[len - 1].x - cx,
              b.trail[len - 1].y - cy,
            );
            targetTrailsGraphics.lineTo(b.position.x - cx, b.position.y - cy);
            targetTrailsGraphics.stroke({
              width: trailWidth,
              color: b.color,
              alpha: 0.4,
            });
          }

          // Projected Future Trajectory (Relative to Dominant Body / SOI)
          if (b.projectedTrail && b.projectedTrail.length > 0) {
            const len = b.projectedTrail.length;
            const refId = (b as any).projectedTrailReferenceId;
            const refBody = refId ? sim.bodies.find(rb => rb.id === refId) : null;
            
            // Base offset (either the reference body or absolute origin)
            const baseX = refBody ? refBody.position.x : 0;
            const baseY = refBody ? refBody.position.y : 0;

            targetTrailsGraphics.moveTo(b.position.x - cx, b.position.y - cy);
            for (let i = 0; i < len; i++) {
              if (i % 2 === 0) {
                targetTrailsGraphics.lineTo(
                  baseX + b.projectedTrail[i].x - cx,
                  baseY + b.projectedTrail[i].y - cy,
                );
              } else {
                targetTrailsGraphics.moveTo(
                  baseX + b.projectedTrail[i].x - cx,
                  baseY + b.projectedTrail[i].y - cy,
                );
              }
            }
            targetTrailsGraphics.stroke({
              width: trailWidth,
              color: "#32aaff",
              alpha: 0.6,
            });
          }

          // Bodies Rendering (Relative)
          if (sim.isBodyBlackHole(b)) {
            if (settingsRef.current.warpEnabled) {
              const orangeSteps = 15;
              for (let j = orangeSteps; j > 0; j--) {
                const r = b.radius + b.radius * 0.4 * (j / orangeSteps);
                if (r * zoom < 4096) {
                  targetGraphics
                    .circle(b.position.x - cx, b.position.y - cy, r)
                    .fill({ color: "#ff6432", alpha: 0.04 });
                }
              }
              const purpleSteps = 10;
              for (let j = purpleSteps; j > 0; j--) {
                const r = b.radius + b.radius * 0.15 * (j / purpleSteps);
                if (r * zoom < 4096) {
                  targetGraphics
                    .circle(b.position.x - cx, b.position.y - cy, r)
                    .fill({ color: "#6432ff", alpha: 0.08 });
                }
              }
              if (b.radius * zoom < 4096) {
                targetGraphics
                  .circle(b.position.x - cx, b.position.y - cy, b.radius)
                  .fill({ color: "#000000", alpha: 1.0 });
              } else {
                targetGraphics
                  .circle(b.position.x - cx, b.position.y - cy, b.radius)
                  .fill({ color: "#000000", alpha: 1.0 });
              }
            } else {
              targetGraphics
                .circle(b.position.x - cx, b.position.y - cy, b.radius * 0.25)
                .fill({ color: "#ffffff", alpha: 1.0 });
              const glowSteps = 15;
              for (let j = glowSteps; j > 0; j--) {
                const r = b.radius * (0.25 + 0.75 * (j / glowSteps));
                if (r * zoom < 4096) {
                  targetGraphics
                    .circle(b.position.x - cx, b.position.y - cy, r)
                    .fill({ color: "#ffffff", alpha: 0.05 });
                }
              }
            }
          } else {
            // Rocket rendering
            if (sim.vehicle && b.id === sim.vehicle.id) {
              const v = sim.vehicle;
              // Ensure the rocket is visible (at least 3 pixels) but scale smoothly
              // when zoomed in to avoid 'floating' or 'burying' artifacts.
              const r = Math.max(b.radius, 3 / zoom);

              const rot = v.rotation;
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);

              // Realistic Rocket Shape: Pointed Nose and Aerodynamic Fins
              const pts = [
                { x: 2.5, y: 0 }, // Nose Tip
                { x: 0.8, y: 0.5 }, // Top Shoulder
                { x: -1.2, y: 0.5 }, // Top Body Rear
                { x: -2.0, y: 1.4 }, // Top Fin Tip
                { x: -1.6, y: 0.5 }, // Top Fin Join
                { x: -1.6, y: -0.5 }, // Bottom Fin Join
                { x: -2.0, y: -1.4 }, // Bottom Fin Tip
                { x: -1.2, y: -0.5 }, // Bottom Body Rear
                { x: 0.8, y: -0.5 }, // Bottom Shoulder
              ];

              let polyPoints = pts.flatMap((p) => [
                b.position.x - cx + (p.x * r * cos - p.y * r * sin),
                b.position.y - cy + (p.x * r * sin + p.y * r * cos),
              ]);

              // Apply warp (Relative)
              if (settingsRef.current.warpEnabled && bgLenses.length > 0) {
                for (let i = 0; i < polyPoints.length; i += 2) {
                  let px = polyPoints[i];
                  let py = polyPoints[i + 1];
                  for (let iter = 0; iter < 3; iter++) {
                    let offsetX = 0,
                      offsetY = 0;
                    for (const lense of bgLenses) {
                      const dx = px - (lense.position.x - cx);
                      const dy = py - (lense.position.y - cy);
                      const distSq = dx * dx + dy * dy;
                      const warpStrength =
                        lense.mass / 20.0 + lense.radius * lense.radius * 0.5;
                      const deformation = warpStrength / Math.max(distSq, 1.0);
                      const clampedDef = Math.min(deformation, 1.0);
                      offsetX += dx * clampedDef;
                      offsetY += dy * clampedDef;
                    }
                    px = polyPoints[i] + offsetX;
                    py = polyPoints[i + 1] + offsetY;
                  }
                  polyPoints[i] = px;
                  polyPoints[i + 1] = py;
                }
              }

              targetGraphics
                .poly(polyPoints)
                .fill({ color: b.color, alpha: 1.0 });

              // Thrust fire
              if ((v as any).thrusting) {
                const firePts = [
                  { x: -1.6, y: 0.4 },
                  { x: -4.0, y: 0 },
                  { x: -1.6, y: -0.4 },
                ];
                let fPoly = firePts.flatMap((p) => [
                  b.position.x - cx + (p.x * r * cos - p.y * r * sin),
                  b.position.y - cy + (p.x * r * sin + p.y * r * cos),
                ]);

                // Apply warp to fire too (Relative)
                if (settingsRef.current.warpEnabled && bgLenses.length > 0) {
                  for (let i = 0; i < fPoly.length; i += 2) {
                    let px = fPoly[i];
                    let py = fPoly[i + 1];
                    for (let iter = 0; iter < 3; iter++) {
                      let offsetX = 0,
                        offsetY = 0;
                      for (const lense of bgLenses) {
                        const dx = px - (lense.position.x - cx);
                        const dy = py - (lense.position.y - cy);
                        const distSq = dx * dx + dy * dy;
                        const warpStrength =
                          lense.mass / 20.0 + lense.radius * lense.radius * 0.5;
                        const deformation =
                          warpStrength / Math.max(distSq, 1.0);
                        const clampedDef = Math.min(deformation, 1.0);
                        offsetX += dx * clampedDef;
                        offsetY += dy * clampedDef;
                      }
                      px = fPoly[i] + offsetX;
                      py = fPoly[i + 1] + offsetY;
                    }
                    fPoly[i] = px;
                    fPoly[i + 1] = py;
                  }
                }
                targetGraphics
                  .poly(fPoly)
                  .fill({ color: "#ff4b00", alpha: 0.8 });

                const corePts = [
                  { x: -1.6, y: 0.2 },
                  { x: -2.8, y: 0 },
                  { x: -1.6, y: -0.2 },
                ];
                let cPoly = corePts.flatMap((p) => [
                  b.position.x - cx + (p.x * r * cos - p.y * r * sin),
                  b.position.y - cy + (p.x * r * sin + p.y * r * cos),
                ]);

                // Apply warp to fire core (Relative)
                if (settingsRef.current.warpEnabled && bgLenses.length > 0) {
                  for (let i = 0; i < cPoly.length; i += 2) {
                    let px = cPoly[i];
                    let py = cPoly[i + 1];
                    for (let iter = 0; iter < 3; iter++) {
                      let offsetX = 0,
                        offsetY = 0;
                      for (const lense of bgLenses) {
                        const dx = px - (lense.position.x - cx);
                        const dy = py - (lense.position.y - cy);
                        const distSq = dx * dx + dy * dy;
                        const warpStrength =
                          lense.mass / 20.0 + lense.radius * lense.radius * 0.5;
                        const deformation =
                          warpStrength / Math.max(distSq, 1.0);
                        const clampedDef = Math.min(deformation, 1.0);
                        offsetX += dx * clampedDef;
                        offsetY += dy * clampedDef;
                      }
                      px = cPoly[i] + offsetX;
                      py = cPoly[i + 1] + offsetY;
                    }
                    cPoly[i] = px;
                    cPoly[i + 1] = py;
                  }
                }
                targetGraphics
                  .poly(cPoly)
                  .fill({ color: "#ffffcc", alpha: 1.0 });
              }
            } else {
              // HIGH FIDELITY LEVEL OF DETAIL (LOD)
              const screenRadius = b.radius * zoom;
              let segments = 32;
              if (screenRadius < 3)
                segments = 12; // Far away: Simple but not a triangle
              else if (screenRadius > 300)
                segments = 128; // Close up: Ultra-smooth
              else if (screenRadius > 100) segments = 64; // Mid-zoom: High fidelity

              const polyPoints = generateCirclePoints(
                b.position.x - cx,
                b.position.y - cy,
                b.radius,
                segments,
              );
              targetGraphics
                .poly(polyPoints)
                .fill({ color: b.color, alpha: 1.0 });
            }
          }

          const isHovered =
            b.id === sim.selectedBodyId ||
            b.id === interactionState.current.hoveredBodyId;
          if (isHovered) {
            // Dynamic Stroke Scaling for hovered/selected bodies
            if (sim.isBodyBlackHole(b)) {
              if (b.radius * zoom < 4096) {
                targetGraphics
                  .circle(b.position.x - cx, b.position.y - cy, b.radius)
                  .stroke({
                    width: responsiveStrokeWidth,
                    color: "#ff3232",
                    alpha: 0.8,
                  });
              }
            } else {
              if (b.radius * zoom < 4096) {
                targetGraphics
                  .circle(b.position.x - cx, b.position.y - cy, b.radius)
                  .stroke({
                    width: responsiveStrokeWidth,
                    color: "#ffffff",
                    alpha: 0.8,
                  });
              }
            }

            if (b.id === sim.selectedBodyId) {
              targetGraphics.moveTo(b.position.x - cx, b.position.y - cy);
              targetGraphics.lineTo(
                b.position.x - cx + b.velocity.x * 2,
                b.position.y - cy + b.velocity.y * 2,
              );
              targetGraphics.stroke({
                width: 1 / zoom,
                color: "#ffffff",
                alpha: 0.4,
              });
            }
          }

          // Labels
          if (zoom > 0.5 || isHovered) {
            activeLabels.add(b.id);
            let txt = textCache.get(b.id);
            if (!txt) {
              txt = new PIXI.Text({
                text: b.name,
                style: {
                  fontFamily: "sans-serif",
                  fontSize: 12,
                  fill: "#ffffff",
                  align: "center",
                },
              });
              txt.anchor.set(0.5, 1);
              textCache.set(b.id, txt);
              labelsContainer.addChild(txt);
            }

            let targetPos = { x: b.position.x - cx, y: b.position.y - cy };

            if (!isLense && bgLenses.length > 0) {
              let apparent = { x: b.position.x - cx, y: b.position.y - cy };
              for (let iter = 0; iter < 3; iter++) {
                let offsetX = 0,
                  offsetY = 0;
                for (const lense of bgLenses) {
                  const dx = apparent.x - (lense.position.x - cx);
                  const dy = apparent.y - (lense.position.y - cy);
                  const distSq = dx * dx + dy * dy;
                  const warpStrength =
                    lense.mass / 20.0 + lense.radius * lense.radius * 0.5;
                  const deformation = warpStrength / Math.max(distSq, 1.0);
                  const clampedDef = Math.min(deformation, 1.0);
                  offsetX += dx * clampedDef;
                  offsetY += dy * clampedDef;
                }
                apparent.x = b.position.x - cx + offsetX;
                apparent.y = b.position.y - cy + offsetY;
              }
              targetPos = apparent;
            }

            txt.alpha = 0.7;
            txt.position.set(targetPos.x, targetPos.y - b.radius - 4 / zoom);
            txt.scale.set(1 / zoom);
          }
        }

        for (const [id, txt] of textCache) {
          if (!activeLabels.has(id)) {
            labelsContainer.removeChild(txt);
            txt.destroy();
            textCache.delete(id);
          }
        }

        const syncTransform = (target: PIXI.Container) => {
          target.position.copyFrom(worldBgContainer.position);
          target.scale.copyFrom(worldBgContainer.scale);
          target.pivot.copyFrom(worldBgContainer.pivot);
        };

        uiGraphics.clear();
        syncTransform(uiGraphics);
        syncTransform(labelsContainer);

        if (sim.rulerStartPoint) {
          const start = sim.rulerStartPoint;
          const end = sim.mouseWorldPos;
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const distWorld = Math.sqrt(dx * dx + dy * dy);
          const distKm = distWorld * 6371;

          uiGraphics
            .moveTo(start.x - cx, start.y - cy)
            .lineTo(end.x - cx, end.y - cy);
          uiGraphics.stroke({
            width: 1.5 / zoom,
            color: "#facc15",
            alpha: 0.8,
          });

          uiGraphics
            .circle(start.x - cx, start.y - cy, 4 / zoom)
            .fill({ color: "#facc15" });
          uiGraphics
            .circle(end.x - cx, end.y - cy, 4 / zoom)
            .fill({ color: "#facc15" });

          // Ruler text
          let distLabel = `${distKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
          if (distKm > 149600000)
            distLabel = `${(distKm / 149600000).toFixed(3)} AU`;
          else if (distKm < 1) distLabel = `${(distKm * 1000).toFixed(1)} m`;

          const rulerTextId = "ruler-label";
          let rtxt = textCache.get(rulerTextId);
          if (!rtxt) {
            rtxt = new PIXI.Text({
              text: distLabel,
              style: {
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13,
                fill: "#facc15",
                fontWeight: "bold",
              },
            });
            rtxt.anchor.set(0.5, 0);
            textCache.set(rulerTextId, rtxt);
            labelsContainer.addChild(rtxt);
          }
          rtxt.text = distLabel;
          rtxt.position.set(
            (start.x - cx + (end.x - cx)) / 2,
            (start.y - cy + (end.y - cy)) / 2 + 10 / zoom,
          );
          rtxt.scale.set(1 / zoom);
          activeLabels.add(rulerTextId);
        }

        if (sim.previewVelocityVector) {
          const isVehicle =
            sim.creationTemplate.presetType === "rocket" ||
            sim.creationTemplate.presetType === "heatProtectedRocket";

          uiGraphics.moveTo(
            sim.previewVelocityVector.start.x - cx,
            sim.previewVelocityVector.start.y - cy,
          );
          uiGraphics.lineTo(
            sim.previewVelocityVector.end.x - cx,
            sim.previewVelocityVector.end.y - cy,
          );
          uiGraphics.stroke({
            width: 1 / zoom,
            color: isVehicle ? "#64ffc8" : "#ff6464",
            alpha: 0.8,
          });

          if (isVehicle) {
            const angle = Math.atan2(
              sim.previewVelocityVector.end.y -
                sim.previewVelocityVector.start.y,
              sim.previewVelocityVector.end.x -
                sim.previewVelocityVector.start.x,
            );
            const r = 4;
            const p1 = {
              x: sim.previewVelocityVector.start.x - cx + Math.cos(angle) * r * 1.5,
              y: sim.previewVelocityVector.start.y - cy + Math.sin(angle) * r * 1.5,
            };
            const p2 = {
              x: sim.previewVelocityVector.start.x - cx + Math.cos(angle + 2.5) * r,
              y: sim.previewVelocityVector.start.y - cy + Math.sin(angle + 2.5) * r,
            };
            const p3 = {
              x: sim.previewVelocityVector.start.x - cx + Math.cos(angle - 2.5) * r,
              y: sim.previewVelocityVector.start.y - cy + Math.sin(angle - 2.5) * r,
            };
            uiGraphics
              .poly([p1.x, p1.y, p2.x, p2.y, p3.x, p3.y])
              .fill({ color: "#ffffff", alpha: 0.8 });
          } else {
            uiGraphics.circle(
              sim.previewVelocityVector.start.x - cx,
              sim.previewVelocityVector.start.y - cy,
              8 / zoom,
            );
            uiGraphics.fill({ color: "#ffffff", alpha: 0.5 });
          }
        }

        if (sim.orbitPreview && sim.orbitPreview.parentId) {
          const parent = sim.bodies.find(
            (b) => b.id === sim.orbitPreview?.parentId,
          );
          if (parent) {
            const dx = sim.orbitPreview.mousePos.x - parent.position.x;
            const dy = sim.orbitPreview.mousePos.y - parent.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist * zoom < 4096) {
              uiGraphics.circle(parent.position.x - cx, parent.position.y - cy, dist);
              uiGraphics.stroke({
                width: 1 / zoom,
                color: "#64c8ff",
                alpha: 0.4,
              });
            }

            uiGraphics.circle(
              sim.orbitPreview.mousePos.x - cx,
              sim.orbitPreview.mousePos.y - cy,
              5 / zoom,
            );
            uiGraphics.fill({ color: "#64c8ff", alpha: 0.8 });
          }
        }
      });
    };

    initPixi();

    return () => {
      isDestroyed = true;
      if (app) {
        try {
          if (app.renderer && app.stage) {
            app.destroy({ removeView: true }, { children: true });
          }
        } catch (e) {
          console.warn("Pixi destroy error:", e);
        }
        for (const txt of textCache.values()) {
          try {
            txt.destroy();
          } catch (e) {}
        }
      }
    };
  }, [sim, onSelectBody, setActivePopUp]);

  return (
    <div
      className="w-full h-full relative cursor-crosshair overflow-hidden border border-gray-800/50 rounded-lg bg-black/20 focus:outline-none"
      tabIndex={0}
    >
      {/* PIXI Canvas Container */}
      <div
        ref={containerRef}
        className="absolute inset-0 touch-none pointer-events-auto"
        style={{ touchAction: "none" }}
      />
    </div>
  );
};
