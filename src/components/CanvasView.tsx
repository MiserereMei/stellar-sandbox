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
  Square,
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
  Terminal,
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
  isStreaming,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(visualSettings);
  const streamingRef = useRef(isStreaming);
  const [hoveredRocketId, setHoveredRocketId] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  // Sync settings ref
  useEffect(() => {
    settingsRef.current = visualSettings;
  }, [visualSettings]);

  useEffect(() => {
    streamingRef.current = isStreaming;
  }, [isStreaming]);

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
    lastReactHoveredRocketId: string | null;
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
    lastReactHoveredRocketId: null,
    previewRotation: -Math.PI / 2,
    lastMouseScreenPos: { x: 0, y: 0 },
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
    sim.rulerEndPoint = null;
  }, [toolMode, sim]);

  // Sync previewBody instantly when creationPreset or addMode changes
  useEffect(() => {
    if (toolMode === "add") {
      const iState = interactionState.current;
      const wx = sim.screenToWorld(
        iState.lastMouseScreenPos.x,
        iState.lastMouseScreenPos.y,
        containerRef.current?.clientWidth || 800,
        containerRef.current?.clientHeight || 600
      );
      
      if (addMode === "orbit" && !iState.orbitParentId) {
        sim.previewBody = null;
      } else {
        const meta = sim.getBodyMetadataFromPreset();
        sim.previewBody = {
          id: "preview",
          ...meta,
          type: sim.creationTemplate.presetType,
          position: wx,
          velocity: { x: 0, y: 0 },
          trail: [],
          rotation: iState.previewRotation,
        } as any;
      }
    } else {
      sim.previewBody = null;
    }
  }, [toolMode, addMode, creationPreset, sim]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      if (streamingRef.current) return;
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
        if (!sim.rulerStartPoint) {
          sim.rulerStartPoint = wx;
        } else {
          // Check if clicking same spot to cancel/exit
          const dx = (wx.x - sim.rulerStartPoint.x) * sim.camera.zoom;
          const dy = (wx.y - sim.rulerStartPoint.y) * sim.camera.zoom;
          if (Math.sqrt(dx * dx + dy * dy) < 10) {
            setToolMode("select");
            sim.rulerStartPoint = null;
            sim.rulerEndPoint = null;
            return;
          }

          if (!sim.rulerEndPoint) {
            sim.rulerEndPoint = wx;
          } else {
            // 3rd click: clear previous and start a NEW one at the current spot
            sim.rulerEndPoint = null;
            sim.rulerStartPoint = wx;
          }
        }
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
          let spawnRotation = iState.previewRotation; // Use the rotated preview angle

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

                  const v: any = {
                    ...newBody,
                    type: sim.creationTemplate.presetType as any,
                    rotation: iState.previewRotation, // Maintain user's rotation even in orbit
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
      if (streamingRef.current) return;
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
        let thresholdSq = Math.max(b.radius, 10 / sim.camera.zoom) ** 2;
        
        // Hysteresis: if this is the currently hovered rocket, give it a larger hit area (e.g. 150px)
        // so the user can move the mouse up to the floating menu without it disappearing.
        if (b.id === iState.lastReactHoveredRocketId) {
          thresholdSq = Math.max(b.radius, 150 / sim.camera.zoom) ** 2;
        }

        const distSq = (b.position.x - wx.x) ** 2 + (b.position.y - wx.y) ** 2;
        if (distSq <= thresholdSq) {
          hoveredId = b.id;
          break;
        }
      }
      iState.hoveredBodyId = hoveredId;
      sim.mouseWorldPos = wx;

      const hoveredBody = hoveredId ? sim.bodies.find(b => b.id === hoveredId) : null;
      const isRocket = hoveredBody && ((hoveredBody as any).type === 'rocket' || (hoveredBody as any).type === 'heatProtectedRocket');
      const finalRocketId = isRocket ? hoveredId : null;
      
      if (iState.lastReactHoveredRocketId !== finalRocketId) {
        iState.lastReactHoveredRocketId = finalRocketId;
        setHoveredRocketId(finalRocketId);
      }

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

          // Update mouseWorldPos after camera/zoom shift
          sim.mouseWorldPos = sim.screenToWorld(
            midX - rect.left,
            midY - rect.top,
            container.clientWidth,
            container.clientHeight,
          );
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

        // Velocity tracking for momentum (In Screen Pixels per frame)
        const vx = sx - iState.lastPanScreenPos.x;
        const vy = sy - iState.lastPanScreenPos.y;

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

      iState.lastMouseScreenPos = { x: sx, y: sy };

      if (toolMode === "add") {
        // Orbit mode special case: Hide preview until a parent body is selected
        if (addMode === "orbit" && !iState.orbitParentId) {
          sim.previewBody = null;
          return;
        }

        const meta = sim.getBodyMetadataFromPreset();
        sim.previewBody = {
          id: "preview",
          ...meta,
          type: sim.creationTemplate.presetType,
          position: wx,
          velocity: { x: 0, y: 0 },
          trail: [],
          rotation: iState.previewRotation,
        } as any;
      } else {
        sim.previewBody = null;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (streamingRef.current) return;
      const iState = interactionState.current;
      iState.activePointers.delete(e.pointerId);
      if (iState.activePointers.size < 2) {
        iState.lastPinchDist = null;
        iState.lastPinchMidpoint = null;
      }

      if (iState.isPanning) {
        iState.isPanning = false;
        // Check if screen-space velocity is high enough to trigger momentum
        const speedSq = iState.panVelocity.x ** 2 + iState.panVelocity.y ** 2;
        if (speedSq > 2.0) { // Fixed screen-pixel threshold
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
      if (streamingRef.current) return;
      const iState = interactionState.current;
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // 1. Capture world point under mouse before zoom
      const worldMouseBefore = sim.screenToWorld(
        sx,
        sy,
        container.clientWidth,
        container.clientHeight,
      );

      if (toolMode === "add") {
        // Rotate preview instead of zooming
        const isRocket = sim.creationTemplate.presetType === 'rocket' || sim.creationTemplate.presetType === 'heatProtectedRocket';
        if (isRocket) {
          const rotationStep = 0.1;
          iState.previewRotation += e.deltaY * 0.001;
          return;
        }
      }

      const zoomSpeed = 0.001;
      const oldZoom = sim.camera.zoom;
      let newZoom = oldZoom * Math.exp(-e.deltaY * zoomSpeed);
      newZoom = Math.max(1e-15, Math.min(newZoom, 1e15));
      
      sim.camera.zoom = newZoom;

      if (!sim.camera.followingId) {
        sim.camera.x = worldMouseBefore.x - (sx - container.clientWidth / 2) / newZoom;
        sim.camera.y = worldMouseBefore.y - (sy - container.clientHeight / 2) / newZoom;
      }

      // Update preview position immediately after zoom shift
      if (toolMode === "add") {
        const newWx = sim.screenToWorld(sx, sy, container.clientWidth, container.clientHeight);
        const meta = sim.getBodyMetadataFromPreset();
        sim.previewBody = {
          id: "preview",
          ...meta,
          type: sim.creationTemplate.presetType,
          position: newWx,
          velocity: { x: 0, y: 0 },
          trail: [],
          rotation: iState.previewRotation,
        } as any;
      }

      // 3. Update mouseWorldPos immediately so tools (ruler) stay in sync
      sim.mouseWorldPos = sim.screenToWorld(
        sx,
        sy,
        container.clientWidth,
        container.clientHeight,
      );
    };

    const onDblClick = (e: MouseEvent) => {
      if (streamingRef.current) return;
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = sim.screenToWorld(
        sx,
        sy,
        container.clientWidth,
        container.clientHeight,
      );

      let clickedBody: Body | null = null;
      for (let i = sim.bodies.length - 1; i >= 0; i--) {
        const b = sim.bodies[i];
        const distSq = (b.position.x - wx.x) ** 2 + (b.position.y - wx.y) ** 2;
        if (distSq <= Math.max(b.radius, 10 / sim.camera.zoom) ** 2) {
          clickedBody = b;
          break;
        }
      }
      
      if (clickedBody) {
        sim.camera.followingId = clickedBody.id;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (streamingRef.current) return;
      // Ignore if typing in a text field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const getTargetVehicle = (): any => {
        if (sim.camera.followingId) {
          const followed = sim.bodies.find(b => b.id === sim.camera.followingId);
          if (followed && ((followed as any).type === 'rocket' || (followed as any).type === 'heatProtectedRocket')) {
            return followed;
          }
        }
        return sim.vehicle;
      };

      const v = getTargetVehicle();
      if (!v) return;
      if (e.key.toLowerCase() === "w") {
        v.thrusting = true;
        v.parentBodyId = null; // Break binding on launch
      }
      if (e.key.toLowerCase() === "a") v.rotatingLeft = true;
      if (e.key.toLowerCase() === "d") v.rotatingRight = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (streamingRef.current) return;
      // Ignore if typing in a text field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const getTargetVehicle = (): any => {
        if (sim.camera.followingId) {
          const followed = sim.bodies.find(b => b.id === sim.camera.followingId);
          if (followed && ((followed as any).type === 'rocket' || (followed as any).type === 'heatProtectedRocket')) {
            return followed;
          }
        }
        return sim.vehicle;
      };

      const v = getTargetVehicle();
      if (!v) return;
      if (e.key.toLowerCase() === "w") v.thrusting = false;
      if (e.key.toLowerCase() === "a") v.rotatingLeft = false;
      if (e.key.toLowerCase() === "d") v.rotatingRight = false;
    };

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    container.addEventListener("dblclick", onDblClick);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("dblclick", onDblClick);
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

      const starsGraphics = new PIXI.Graphics();
      const gridGraphics = new PIXI.Graphics();
      const worldBgContainer = new PIXI.Container();
      const worldFgContainer = new PIXI.Container();

      const backgroundTrailsGraphics = new PIXI.Graphics();
      const bodiesGraphics = new PIXI.Graphics();
      const foregroundTrailsGraphics = new PIXI.Graphics();
      const foregroundBodiesGraphics = new PIXI.Graphics();

      // Photorealistic Explosion Layer
      const explosionsContainer = new PIXI.Container();
      explosionsContainer.blendMode = 'add';
      const expBlur = new PIXI.BlurFilter(4);
      explosionsContainer.filters = [expBlur];
      const explosionsGraphics = new PIXI.Graphics();
      explosionsContainer.addChild(explosionsGraphics);

      const labelsContainer = new PIXI.Container();
      const uiGraphics = new PIXI.Graphics();

      bgFilteredLayer.addChild(starsGraphics, gridGraphics, worldBgContainer);
      fgFilteredLayer.addChild(worldFgContainer);
      unfilteredLayer.addChild(labelsContainer, uiGraphics);

      worldBgContainer.addChild(backgroundTrailsGraphics, bodiesGraphics);
      worldFgContainer.addChild(
        foregroundTrailsGraphics,
        foregroundBodiesGraphics,
        explosionsContainer
      );

      app.ticker.add(() => {
        if (isDestroyed) return;

        // Sync settings
        bgFilter.enabled = settingsRef.current.warpEnabled;
        fgFilter.enabled = settingsRef.current.warpEnabled;
        gridGraphics.visible = settingsRef.current.gridEnabled;
        starsGraphics.visible = settingsRef.current.starsEnabled;
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

        if (sim.isJumping) return;

        // Apply Momentum Pan
        const iState = interactionState.current;
        // Pan momentum (Zoom-invariant)
        if (iState.hasMomentum) {
          sim.camera.x -= iState.panVelocity.x / sim.camera.zoom;
          sim.camera.y -= iState.panVelocity.y / sim.camera.zoom;
          iState.panVelocity.x *= 0.95;
          iState.panVelocity.y *= 0.95;
          if (iState.panVelocity.x ** 2 + iState.panVelocity.y ** 2 < 0.01) {
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

        let cx = sim.camera.x;
        let cy = sim.camera.y;
        let zoom = sim.camera.zoom;

        if (streamingRef.current && sim.cinematicCamera.active) {
          // Shake
          if (sim.cinematicCamera.shake > 0.01) {
            const intensity = sim.cinematicCamera.shake * 20; // max 20px shake
            cx += (Math.random() - 0.5) * intensity / zoom;
            cy += (Math.random() - 0.5) * intensity / zoom;
          }
          
          // Offset
          if (sim.cinematicCamera.offsetX !== 0 || sim.cinematicCamera.offsetY !== 0) {
            cx -= (sim.cinematicCamera.offsetX * width / 2) / zoom;
            cy -= (sim.cinematicCamera.offsetY * height / 2) / zoom;
          }
          
          // Zoom Scale
          if (sim.cinematicCamera.zoomScale > 0 && sim.camera.followingId) {
             const target = sim.bodies.find(b => b.id === sim.camera.followingId);
             if (target) {
                // Determine screen's shortest dimension
                const minDim = Math.min(width, height);
                // zoomScale is fraction of screen the object diameter should cover
                const desiredDiameterPixels = minDim * sim.cinematicCamera.zoomScale;
                const objectDiameterUnits = Math.max(target.radius, 0.0001) * 2;
                zoom = desiredDiameterPixels / objectDiameterUnits;
             }
          }
        }


        const idealStep = 150 / zoom;
        // 10x Shallower: Increase log sensitivity so we cross layers 10x faster
        const logStep = Math.log10(idealStep) * 10;
        const basePower = Math.floor(logStep);

        starsGraphics.clear();

        // FRACTAL STARS: Maintain constant density with a dense, multi-layered hierarchy
        const hash = (x: number, y: number, p: number) => {
          const val = Math.sin(x * 12.9898 + y * 78.233 + p * 37.719) * 43758.5453123;
          return val - Math.floor(val);
        };

        // Ultra-Smooth Overlap: Loop through more layers with a wider Gaussian spread
        for (let p = basePower - 6; p <= basePower + 6; p++) {
          const worldGridStep = Math.pow(10, p / 10);
          const screenGridSize = worldGridStep * zoom;
          
          // Wider Gaussian Fade (Sigma 2.2) for silkier transitions
          const dist = Math.abs(logStep - p);
          const sigma = 2.2;
          const alpha = Math.exp(-Math.pow(dist, 2) / (2 * Math.pow(sigma, 2)));

          if (alpha > 0.01 && screenGridSize > 1) {
            let offsetX = (width / 2 - cx * zoom) % screenGridSize;
            let offsetY = (height / 2 - cy * zoom) % screenGridSize;
            
            if (offsetX < 0) offsetX += screenGridSize;
            if (offsetY < 0) offsetY += screenGridSize;

            // Determine the starting cell ID in world space for this screen-view
            const startIdX = Math.floor((cx * zoom - width / 2) / screenGridSize);
            const startIdY = Math.floor((cy * zoom - height / 2) / screenGridSize);

            let ix = 0;
            for (let x = offsetX - screenGridSize; x < width + screenGridSize; x += screenGridSize) {
              let iy = 0;
              for (let y = offsetY - screenGridSize; y < height + screenGridSize; y += screenGridSize) {
                const cellIdX = startIdX + ix;
                const cellIdY = startIdY + iy;
                
                // Stable random offsets within the cell
                const rx = hash(cellIdX, cellIdY, p);
                const ry = hash(cellIdX, cellIdY, p + 10);
                
                const sx = x + rx * screenGridSize;
                const sy = y + ry * screenGridSize;

                if (sx >= 0 && sx <= width && sy >= 0 && sy <= height) {
                  // Fake Doppler Effect: Blue tint for detailed/new, Red tint for coarse/old
                  // Using p relative to basePower to determine shift
                  const shift = p - basePower;
                  let color = 0xffffff;
                  if (shift < 0) color = 0xe0f0ff;      // Blueshift (Cool/New)
                  else if (shift > 0) color = 0xffe0d0; // Redshift (Warm/Old)
                  
                  // Asymmetric Thinning: 
                  // Coarse layers (p > logStep) just fade out at full size during zoom-in.
                  // Fine layers (p < logStep) thin out as they fade during zoom-out.
                  const radius = (p > logStep) ? 2.0 : (0.5 + (1.5 * alpha));

                  starsGraphics.rect(sx - radius, sy - radius, radius * 2, radius * 2).fill({ color, alpha: alpha * 0.3 });
                }
                iy++;
              }
              ix++;
            }
          }
        }

        // Shepard Tone Logarithmic Grid (Restore standard 10^p hierarchy)
        gridGraphics.clear();
        
        const gridLogStep = Math.log10(75 / zoom);
        const gridBasePower = Math.floor(gridLogStep);

        // Draw multiple layers for the grid
        for (let p = gridBasePower - 1; p <= gridBasePower + 2; p++) {
          const worldGridStep = Math.pow(10, p);
          const screenGridSize = worldGridStep * zoom;
          
          const dist = gridLogStep - p; 
          let alpha = 0.02;

          if (dist <= 0) {
            // Older/Persistent layers stay at stable alpha
            alpha = 0.08; 
          } else if (dist < 0.2) {
            // Ultra-Fast Birth: Very tight range (0.2) and sqrt curve for near-instant pop-in
            const t = 1 - (dist / 0.2); // 0 to 1
            const smoothT = Math.pow(t, 0.5); 
            alpha = 0.02 + (smoothT * 0.06);
          }

          if (alpha > 0.001 && screenGridSize > 10) {
            const offsetXGrid = (width / 2 - cx * zoom) % screenGridSize;
            const offsetYGrid = (height / 2 - cy * zoom) % screenGridSize;

            for (let x = offsetXGrid; x < width; x += screenGridSize) {
              gridGraphics.moveTo(x, 0).lineTo(x, height);
            }
            for (let y = offsetYGrid; y < height; y += screenGridSize) {
              gridGraphics.moveTo(0, y).lineTo(width, y);
            }
            
            const strokeWidth = p > gridLogStep ? 1.5 : 1.0;
            gridGraphics.stroke({ width: strokeWidth, color: "#ffffff", alpha: alpha });
          }
        }

        // Transform: Using manual Screen-Space Projection to prevent GPU precision clipping
        // Containers are centered, but scale is kept at 1.0 to avoid driver-level float errors at extreme zoom.
        worldBgContainer.position.set(width / 2, height / 2);
        worldBgContainer.scale.set(1.0);
        worldBgContainer.pivot.set(0, 0);

        worldFgContainer.position.copyFrom(worldBgContainer.position);
        worldFgContainer.scale.set(1.0);
        worldFgContainer.pivot.copyFrom(worldBgContainer.pivot);

        // UI Layer
        labelsContainer.position.set(width / 2, height / 2);
        labelsContainer.scale.set(1.0);
        uiGraphics.position.set(width / 2, height / 2);
        uiGraphics.scale.set(1.0);

        backgroundTrailsGraphics.clear();
        foregroundTrailsGraphics.clear();
        bodiesGraphics.clear();
        foregroundBodiesGraphics.clear();

        const activeLabels = new Set<string>();
        const responsiveStrokeWidth = 2.0; // In Screen Pixels
        const trailWidth = 1.5; // In Screen Pixels

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
              targetTrailsGraphics.moveTo((b.trail[i].x - cx) * zoom, (b.trail[i].y - cy) * zoom);
              targetTrailsGraphics.lineTo(
                (b.trail[i + 1].x - cx) * zoom,
                (b.trail[i + 1].y - cy) * zoom,
              );
              targetTrailsGraphics.stroke({
                width: trailWidth,
                color: b.color,
                alpha,
              });
            }
            targetTrailsGraphics.moveTo(
              (b.trail[len - 1].x - cx) * zoom,
              (b.trail[len - 1].y - cy) * zoom,
            );
            targetTrailsGraphics.lineTo((b.position.x - cx) * zoom, (b.position.y - cy) * zoom);
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

            targetTrailsGraphics.moveTo((b.position.x - cx) * zoom, (b.position.y - cy) * zoom);
            let drawing = true;
            let segmentCounter = 0;
            for (let i = 0; i < len; i++) {
              const px = (baseX + b.projectedTrail[i].x - cx) * zoom;
              const py = (baseY + b.projectedTrail[i].y - cy) * zoom;
              
              if (drawing) {
                targetTrailsGraphics.lineTo(px, py);
              } else {
                targetTrailsGraphics.moveTo(px, py);
              }

              segmentCounter++;
              if (segmentCounter > 15) { // Dash every 15 points for visual consistency
                segmentCounter = 0;
                drawing = !drawing;
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
                const r = (b.radius + b.radius * 0.4 * (j / orangeSteps)) * zoom;
                if (r < 16384) {
                  targetGraphics
                    .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, r)
                    .fill({ color: "#ff6432", alpha: 0.04 });
                }
              }
              const purpleSteps = 10;
              for (let j = purpleSteps; j > 0; j--) {
                const r = (b.radius + b.radius * 0.15 * (j / purpleSteps)) * zoom;
                if (r < 16384) {
                  targetGraphics
                    .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, r)
                    .fill({ color: "#6432ff", alpha: 0.08 });
                }
              }
              const horizonR = b.radius * zoom;
              targetGraphics
                .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, horizonR)
                .fill({ color: "#000000", alpha: 1.0 });
            } else {
              targetGraphics
                .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, b.radius * 0.25 * zoom)
                .fill({ color: "#ffffff", alpha: 1.0 });
              const glowSteps = 15;
              for (let j = glowSteps; j > 0; j--) {
                const r = b.radius * (0.25 + 0.75 * (j / glowSteps)) * zoom;
                if (r < 16384) {
                  targetGraphics
                    .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, r)
                    .fill({ color: "#ffffff", alpha: 0.05 });
                }
              }
            }
          } else {
            // Rocket rendering
            const isRocketType = (b as any).type === 'rocket' || (b as any).type === 'heatProtectedRocket';
            if (isRocketType) {
              const v = b as any;
              const l_px = Math.max((v as any).length || b.radius * 2, 6 / zoom) * zoom;
              const r_px = l_px / 2; 

              const rot = v.rotation;
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);

              // Realistic Rocket Shape: Screen space coordinates
              const pts = [
                { x: 1.0, y: 0 },    // Nose Tip
                { x: 0.7, y: 0.15 }, // Fairing Shoulder
                { x: -0.8, y: 0.15 },// Main Body End
                { x: -1.0, y: 0.4 }, // Top Fin Tip
                { x: -0.9, y: 0.15 },// Top Fin Join
                { x: -0.9, y: -0.15 },// Bottom Fin Join
                { x: -1.0, y: -0.4 },// Bottom Fin Tip
                { x: -0.8, y: -0.15 },// Main Body End Bottom
                { x: 0.7, y: -0.15 }, // Fairing Shoulder Bottom
              ];

              let polyPoints = pts.flatMap((p) => [
                (b.position.x - cx) * zoom + (p.x * r_px * cos - p.y * r_px * sin),
                (b.position.y - cy) * zoom + (p.x * r_px * sin + p.y * r_px * cos),
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
                  { x: -0.9, y: 0.12 },
                  { x: -3.0, y: 0 },
                  { x: -0.9, y: -0.12 },
                ];
                let fPoly = firePts.flatMap((p) => [
                  (b.position.x - cx) * zoom + (p.x * r_px * cos - p.y * r_px * sin),
                  (b.position.y - cy) * zoom + (p.x * r_px * sin + p.y * r_px * cos),
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
                  { x: -0.9, y: 0.08 },
                  { x: -2.0, y: 0 },
                  { x: -0.9, y: -0.08 },
                ];
                let cPoly = corePts.flatMap((p) => [
                  (b.position.x - cx) * zoom + (p.x * r_px * cos - p.y * r_px * sin),
                  (b.position.y - cy) * zoom + (p.x * r_px * sin + p.y * r_px * cos),
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
                segments = 12; // Far away
              else if (screenRadius > 2000)
                segments = 2048; // Ultra-high zoom (Horizon view)
              else if (screenRadius > 1000)
                segments = 512; // Very close
              else if (screenRadius > 300)
                segments = 128; // Close up
              else if (screenRadius > 100)
                segments = 64; // Mid-zoom

              const polyPoints = generateCirclePoints(
                (b.position.x - cx) * zoom,
                (b.position.y - cy) * zoom,
                b.radius * zoom,
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
              if (b.radius * zoom < 16384) {
                targetGraphics
                  .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, b.radius * zoom)
                  .stroke({
                    width: responsiveStrokeWidth,
                    color: "#ff3232",
                    alpha: 0.8,
                  });
              }
            } else {
              if (b.radius * zoom < 16384) {
                targetGraphics
                  .circle((b.position.x - cx) * zoom, (b.position.y - cy) * zoom, b.radius * zoom)
                  .stroke({
                    width: responsiveStrokeWidth,
                    color: "#32aaff",
                    alpha: 0.8,
                  });
              }
            }

            if (b.id === sim.selectedBodyId) {
              targetGraphics.moveTo((b.position.x - cx) * zoom, (b.position.y - cy) * zoom);
              targetGraphics.lineTo(
                (b.position.x - cx + b.velocity.x * 2) * zoom,
                (b.position.y - cy + b.velocity.y * 2) * zoom,
              );
              targetGraphics.stroke({
                width: 1.5,
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

            if (!isLense && bgLenses.length > 0 && settingsRef.current.warpEnabled) {
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
            txt.position.set(targetPos.x * zoom, (targetPos.y - b.radius) * zoom - 4);
            txt.scale.set(1);
          }
        }

        // Render Preview Body (Ghost) - Shows what's about to be placed
        if (sim.previewBody) {
          const b = sim.previewBody;
          const isRocket = (b as any).type === 'rocket' || (b as any).type === 'heatProtectedRocket';
          const px = (b.position.x - cx) * zoom;
          const py = (b.position.y - cy) * zoom;

          if (isRocket) {
            const v = b as any;
            const l_px = Math.max(v.length || b.radius * 2, 6 / zoom) * zoom;
            const r_px = l_px / 2;
            const rot = v.rotation;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const pts = [
              { x: 1.0, y: 0 }, { x: 0.7, y: 0.15 }, { x: -0.8, y: 0.15 },
              { x: -1.0, y: 0.4 }, { x: -0.9, y: 0.15 }, { x: -0.9, y: -0.15 },
              { x: -1.0, y: -0.4 }, { x: -0.8, y: -0.15 }, { x: 0.7, y: -0.15 },
            ];
            const polyPoints = pts.flatMap((p) => [
              px + (p.x * r_px * cos - p.y * r_px * sin),
              py + (p.x * r_px * sin + p.y * r_px * cos),
            ]);
            bodiesGraphics.poly(polyPoints).fill({ color: b.color, alpha: 0.4 });
            bodiesGraphics.poly(polyPoints).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
          } else {
            bodiesGraphics.circle(px, py, b.radius * zoom).fill({ color: b.color, alpha: 0.4 });
            bodiesGraphics.circle(px, py, b.radius * zoom).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
          }
        }

        // --- Render Photorealistic Turbulent Explosions ---
        explosionsGraphics.clear();
        for (const exp of sim.explosions) {
          const progress = exp.time / exp.maxTime;
          const alpha = 1.0 - Math.pow(progress, 1.5);
          const worldRadius = exp.radius * (0.1 + Math.pow(progress, 0.4) * 0.9);
          const screenRadius = worldRadius * zoom;
          const sx = (exp.x - cx) * zoom;
          const sy = (exp.y - cy) * zoom;

          // Helper for turbulent shapes
          const drawTurbulence = (radius: number, segments: number, noise: number, color: string, a: number, seed: number) => {
            const points = [];
            for (let i = 0; i <= segments; i++) {
              const angle = (i / segments) * Math.PI * 2;
              // Lower frequencies (3 and 5) for smoother, wobbly edges
              const noiseVal = Math.sin(angle * 3 + seed + exp.time * 2) * noise + Math.cos(angle * 5 - seed) * (noise * 0.5);
              const r = radius * (1 + noiseVal);
              points.push(sx + Math.cos(angle) * r, sy + Math.sin(angle) * r);
            }
            explosionsGraphics.poly(points).fill({ color, alpha: a });
          };

          if ((exp as any).isSupernova) {
             // 1. Outer Nebula (Subtle Organic Wobble)
             // Using exp.seed for unique patterns
             drawTurbulence(screenRadius, 40, 0.03, "#7c3aed", alpha * 0.1, exp.seed);
             drawTurbulence(screenRadius * 0.8, 35, 0.02, "#6d28d9", alpha * 0.15, exp.seed + 123);
             
             // 2. Cyan Plasma core (Minimal wobble)
             drawTurbulence(screenRadius * 0.6, 30, 0.015, "#22d3ee", alpha * 0.25, exp.seed + 456);
             
             // 3. Intense White Core
             explosionsGraphics.circle(sx, sy, screenRadius * (0.25 + (1-progress)*0.2)).fill({ color: "#ffffff", alpha: alpha * 0.9 });

             // 4. Smooth Shockwaves
             explosionsGraphics.circle(sx, sy, screenRadius * progress).stroke({ color: "#ffffff", width: 8, alpha: alpha * 0.15 });
          } else {
             // REGULAR EXPLOSION (Minimal Organic Wobble)
             drawTurbulence(screenRadius, 20, 0.04, "#ea580c", alpha * 0.3, exp.seed);
             drawTurbulence(screenRadius * 0.7, 15, 0.03, "#f97316", alpha * 0.4, exp.seed + 789);
             
             // White-hot center
             explosionsGraphics.circle(sx, sy, screenRadius * 0.3).fill({ color: "#ffffff", alpha: alpha * 0.8 });

             // Sharp shockwave
             explosionsGraphics.circle(sx, sy, screenRadius * Math.pow(progress, 0.3)).stroke({ color: "#ffffff", width: 2, alpha: alpha * 0.4 });
          }
        }

        // Update hover UI DOM position
        if (iState.lastReactHoveredRocketId) {
          const hoverEl = document.getElementById('hover-ui-rocket');
          if (hoverEl) {
            const b = sim.bodies.find(b => b.id === iState.lastReactHoveredRocketId);
            if (b) {
              const sx = (b.position.x - cx) * zoom + container.clientWidth / 2;
              const sy = (b.position.y - cy) * zoom + container.clientHeight / 2;
              hoverEl.style.transform = `translate(${sx}px, ${sy - (b.radius * zoom) - 30}px) translateX(-50%) translateY(-100%)`;
            }
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
          const isFinished = !!sim.rulerEndPoint;
          const end = isFinished ? sim.rulerEndPoint! : sim.mouseWorldPos;
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const distWorld = Math.sqrt(dx * dx + dy * dy);
          const distKm = distWorld * 6371;

          // Draw the line and distance (either fixed or dynamic to mouse)
          uiGraphics
            .moveTo((start.x - cx) * zoom, (start.y - cy) * zoom)
            .lineTo((end.x - cx) * zoom, (end.y - cy) * zoom);
          uiGraphics.stroke({
            width: 2,
            color: "#facc15",
            alpha: 0.8,
          });

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
            ((start.x - cx + (end.x - cx)) / 2) * zoom,
            ((start.y - cy + (end.y - cy)) / 2) * zoom + 12,
          );
          rtxt.scale.set(1);
          activeLabels.add(rulerTextId);

          // Draw endpoints
          uiGraphics
            .circle((start.x - cx) * zoom, (start.y - cy) * zoom, 4)
            .fill({ color: "#facc15" });
          
          uiGraphics
            .circle((end.x - cx) * zoom, (end.y - cy) * zoom, 4)
            .fill({ color: "#facc15" });
        }

        if (sim.previewVelocityVector) {
          const isVehicle =
            sim.creationTemplate.presetType === "rocket" ||
            sim.creationTemplate.presetType === "heatProtectedRocket";

          uiGraphics.moveTo(
            (sim.previewVelocityVector.start.x - cx) * zoom,
            (sim.previewVelocityVector.start.y - cy) * zoom,
          );
          uiGraphics.lineTo(
            (sim.previewVelocityVector.end.x - cx) * zoom,
            (sim.previewVelocityVector.end.y - cy) * zoom,
          );
          uiGraphics.stroke({
            width: 1,
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
              x: (sim.previewVelocityVector.start.x - cx) * zoom + Math.cos(angle) * r * 1.5,
              y: (sim.previewVelocityVector.start.y - cy) * zoom + Math.sin(angle) * r * 1.5,
            };
            const p2 = {
              x: (sim.previewVelocityVector.start.x - cx) * zoom + Math.cos(angle + 2.5) * r,
              y: (sim.previewVelocityVector.start.y - cy) * zoom + Math.sin(angle + 2.5) * r,
            };
            const p3 = {
              x: (sim.previewVelocityVector.start.x - cx) * zoom + Math.cos(angle - 2.5) * r,
              y: (sim.previewVelocityVector.start.y - cy) * zoom + Math.sin(angle - 2.5) * r,
            };
            uiGraphics
              .poly([p1.x, p1.y, p2.x, p2.y, p3.x, p3.y])
              .fill({ color: "#ffffff", alpha: 0.8 });
          } else {
            uiGraphics.circle(
              (sim.previewVelocityVector.start.x - cx) * zoom,
              (sim.previewVelocityVector.start.y - cy) * zoom,
              8,
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
              uiGraphics.circle((parent.position.x - cx) * zoom, (parent.position.y - cy) * zoom, dist * zoom);
              uiGraphics.stroke({
                width: 1,
                color: "#64c8ff",
                alpha: 0.4,
              });
            }

            uiGraphics.circle(
              (sim.orbitPreview.mousePos.x - cx) * zoom,
              (sim.orbitPreview.mousePos.y - cy) * zoom,
              5,
            );
            uiGraphics.fill({ color: "#64c8ff", alpha: 0.8 });
          }
        }

        for (const [id, txt] of textCache) {
          if (!activeLabels.has(id)) {
            labelsContainer.removeChild(txt);
            txt.destroy();
            textCache.delete(id);
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
      
      {/* DOM Hover UI */}
      {hoveredRocketId && (() => {
        const b = sim.bodies.find(b => b.id === hoveredRocketId) as any;
        if (!b) return null;
        return (
          <div 
            id="hover-ui-rocket"
            className="absolute left-0 top-0 pointer-events-auto flex items-center bg-[#11141b]/90 backdrop-blur border border-white/20 shadow-2xl rounded-xl p-1.5 gap-1.5 z-50 transition-opacity duration-200"
            onMouseEnter={() => {
              // Lock hover while interacting with menu
              interactionState.current.lastReactHoveredRocketId = hoveredRocketId;
              setHoveredRocketId(hoveredRocketId);
            }}
            onMouseLeave={() => {
              interactionState.current.lastReactHoveredRocketId = null;
              setHoveredRocketId(null);
            }}
          >
            <button 
              onClick={() => {
                if (b.isAutopilotActive) {
                  sim.stopAutopilot(b.id);
                } else if (b.script) {
                  // The user can't pass 'logCallback' here properly since we refactored it. 
                  // But wait, we refactored startAutopilot to take vehicleId.
                  // We'll pass a dummy log callback because the simulation now creates its own and broadcasts.
                  sim.startAutopilot(b.script, b.id, (msg) => {
                    const time = sim.missionTime;
                    (window as any)._fullLogBuffer = (window as any)._fullLogBuffer || [];
                    (window as any)._fullLogBuffer.push({ time, msg });
                  });
                } else {
                  // No script? Just open editor.
                  window.open(`/?editor=${b.id}`, `Editor_${b.id}`, 'width=800,height=600,left=200,top=100');
                }
                forceRender(p => p + 1);
              }}
              title={b.isAutopilotActive ? "Disengage Autopilot" : "Engage Autopilot"}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${b.isAutopilotActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/40' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40'}`}
            >
              {b.isAutopilotActive ? <Square size={12} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
            </button>
            <button 
              onClick={() => {
                window.open(`/?editor=${b.id}`, `Editor_${b.id}`, 'width=800,height=600,left=200,top=100');
              }}
              title="Edit Autopilot Script"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 transition-colors text-white"
            >
              <Terminal size={14} />
            </button>
          </div>
        );
      })()}
    </div>
  );
};
