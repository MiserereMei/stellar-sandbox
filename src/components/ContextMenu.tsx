import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface ContextMenuProps {
  x: number;
  y: number;
  isTriggered: boolean;
  onClose: () => void;
  options: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    color?: string;
  }[];
  previewBody?: {
    color: string;
    radius: number;
    initialScreenRadius: number;
    objectScreenPos?: { x: number, y: number };
    name?: string;
    type?: 'planet' | 'rocket' | 'blackhole';
    thrusting?: boolean;
    rotation?: number;
  } | null;
  quickActions?: {
    icon: React.ReactNode;
    onClick: () => void;
    color?: string;
    active?: boolean;
  }[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, isTriggered, onClose, options, previewBody, quickActions }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const isReadyRef = React.useRef(false); // Use ref to avoid stale closures
  const containerRef = React.useRef<HTMLDivElement>(null);

  const maxPreviewSize = 280;
  const minPreviewSize = 120;
  const canvasSize = (previewBody?.initialScreenRadius || 10) * 2;
  const finalSize = Math.min(maxPreviewSize, Math.max(minPreviewSize, canvasSize * 4));

  // --- POSITION CALCULATIONS ---
  const margin = 20;
  const quickActionsHeight = (quickActions && quickActions.length > 0) ? 48 : 0;
  const estimatedHeight = 12 + (options.length * 42) + ((options.length - 1) * 4) + quickActionsHeight;
  const gap = 30;
  const menuWidth = 190;
  const isUp = y >= window.innerHeight / 2;
  const isLeft = x < window.innerWidth / 2;

  let baseStickerY = 0;
  let baseMenuY = 0;
  let finalMenuX = 0;
  let clampedStickerX = 0;

  if (previewBody) {
    // STICKER LOGIC: Center GAP on finger (current robust logic)
    if (isUp) {
      baseMenuY = y - gap / 2 - estimatedHeight;
      baseStickerY = y + gap / 2;
    } else {
      baseStickerY = y - gap / 2 - finalSize;
      baseMenuY = y + gap / 2;
    }

    const widerWidth = Math.max(menuWidth, finalSize);
    let blockLeft = x - widerWidth / 2;
    blockLeft = Math.max(margin, Math.min(window.innerWidth - margin - widerWidth, blockLeft));

    if (isLeft) {
      finalMenuX = blockLeft;
      clampedStickerX = blockLeft;
    } else {
      finalMenuX = blockLeft + widerWidth - menuWidth;
      clampedStickerX = blockLeft + widerWidth - finalSize;
    }

    // Vertical Clamping for the block
    let shiftY = 0;
    const blockTop = Math.min(baseStickerY, baseMenuY);
    const blockBottom = Math.max(baseStickerY + finalSize, baseMenuY + estimatedHeight);
    if (blockTop < margin) shiftY = margin - blockTop;
    if (blockBottom > window.innerHeight - margin) shiftY = (window.innerHeight - margin) - blockBottom;
    baseStickerY += shiftY;
    baseMenuY += shiftY;

  } else {
    // STICKERLESS LOGIC: Corner anchor to finger with safety offset
    const vOffset = 15;
    finalMenuX = isLeft ? x : x - menuWidth;
    baseMenuY = isUp ? y - estimatedHeight - vOffset : y + vOffset;

    // Safety clamp to screen
    finalMenuX = Math.max(margin, Math.min(window.innerWidth - margin - menuWidth, finalMenuX));
    baseMenuY = Math.max(margin, Math.min(window.innerHeight - margin - estimatedHeight, baseMenuY));
  }



  useEffect(() => {
    if (!isTriggered) {
      setIsReady(false);
      isReadyRef.current = false;
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      // We allow tracking even if not ready, but maybe don't vibrate yet
      if (!containerRef.current) return;
      const buttons = containerRef.current.querySelectorAll('button[data-index]');
      let foundIndex: number | null = null;

      buttons.forEach((btn) => {
        const rect = btn.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          foundIndex = parseInt(btn.getAttribute('data-index') || '-1');
        }
      });

      const newIndex = foundIndex !== -1 ? foundIndex : null;
      if (newIndex !== activeIndex && newIndex !== null && isReadyRef.current) {
        if (navigator.vibrate) navigator.vibrate(5);
      }
      setActiveIndex(newIndex);
    };

    const handlePointerUp = (e: PointerEvent) => {
      // ONLY trigger if the menu was fully ready to prevent accidental selections
      if (isReadyRef.current && activeIndex !== null) {
        if (options[activeIndex]) {
          options[activeIndex].onClick();
          onClose();
        } else if (quickActions && quickActions[activeIndex - options.length]) {
          quickActions[activeIndex - options.length].onClick();
          onClose();
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeIndex, options, onClose, isTriggered]);

  return (
    <div className="fixed inset-0 z-[1000] pointer-events-none select-none">
      {/* Background Shade */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isTriggered ? 1 : 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/60"
      />

      {/* Closing Layer - Only active for taps, doesn't block pointer capture */}
      <div
        className="absolute inset-0 pointer-events-auto"
        onPointerDown={(e) => {
          // If we are already sliding, don't close immediately on first touch of the background
          if (!isReadyRef.current) return;
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Lifted Object Preview (Sticker Effect) */}
      {previewBody && (() => {
        const visualScale = previewBody.type === 'blackhole' ? 1.5 : (previewBody.type === 'rocket' ? 1.5 : 1.0);
        const startSize = canvasSize * visualScale;
        const startX = (previewBody.objectScreenPos?.x || x) - startSize / 2;
        const startY = (previewBody.objectScreenPos?.y || y) - startSize / 2;

        return (
          <motion.div
            key="sticker-preview"
            initial={{
              width: startSize,
              height: startSize,
              borderRadius: "100%",
              x: startX,
              y: startY,
              opacity: 1,
              scale: 1
            }}
            animate={{
              width: isTriggered ? finalSize : startSize * 1.5,
              height: isTriggered ? finalSize : startSize * 1.5,
              x: isTriggered
                ? clampedStickerX
                : (previewBody.objectScreenPos?.x || x) - (startSize * 1.5) / 2,
              y: isTriggered
                ? baseStickerY
                : (previewBody.objectScreenPos?.y || y) - (startSize * 1.5) / 2,
              scale: 1,
              opacity: 1,
            }}
            exit={{
              x: startX,
              y: startY,
              width: startSize,
              height: startSize,
              opacity: 1,
              scale: 1,
              transition: { duration: 0.2, ease: "easeIn" }
            }}
            transition={isTriggered ? {
              type: "spring",
              damping: 22,
              stiffness: 350, // Faster/Snappier acceleration
              restDelta: 0.001,
              delay: 0.18, // The 1/3 "hidden wait" period
              mass: 0.8
            } : {
              duration: 0.6,
              ease: "linear"
            }}
            className="absolute pointer-events-none z-[1001]"
          >
            <div className="w-full h-full relative flex items-center justify-center">
              {previewBody.type === 'blackhole' ? (
                <div className="w-full h-full relative flex items-center justify-center">
                  <svg viewBox="-1.6 -1.6 3.2 3.2" className="w-full h-full overflow-visible">
                    {/* Orange Glow - 15 Layers */}
                    {Array.from({ length: 15 }).map((_, j) => (
                      <circle
                        key={`orange-${j}`}
                        cx="0" cy="0"
                        r={1 + 0.4 * ((j + 1) / 15)}
                        fill="#ff6432"
                        fillOpacity={0.04}
                      />
                    ))}
                    {/* Purple Glow - 10 Layers */}
                    {Array.from({ length: 10 }).map((_, j) => (
                      <circle
                        key={`purple-${j}`}
                        cx="0" cy="0"
                        r={1 + 0.15 * ((j + 1) / 10)}
                        fill="#6432ff"
                        fillOpacity={0.08}
                      />
                    ))}
                    {/* Event Horizon - Exact Central Sphere */}
                    <circle cx="0" cy="0" r="1" fill="black" />
                  </svg>
                </div>
              ) : previewBody.type === 'rocket' ? (
                <div className="w-full h-full flex items-center justify-center">
                  <motion.svg
                    viewBox="-1 -1.5 2 3"
                    className="w-[85%] h-[85%] drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] overflow-visible"
                    initial={{ rotate: (previewBody.rotation || 0) * (180 / Math.PI) + 90 }}
                    animate={{
                      rotate: isTriggered ? 0 : (previewBody.rotation || 0) * (180 / Math.PI) + 90,
                      scale: isTriggered ? 1.2 : 1
                    }}
                    exit={{ rotate: (previewBody.rotation || 0) * (180 / Math.PI) + 90 }}
                    transition={{ type: "spring", damping: 20, stiffness: 150 }}
                  >
                    {/* Thrust Flame (Match PIXI style) */}
                    {previewBody.thrusting && (
                      <motion.path
                        d="M -0.15 0.8 L 0.15 0.8 L 0 1.5 Z"
                        fill="#ff6432"
                        animate={{ opacity: [0.4, 1, 0.4], scaleY: [1, 1.4, 1] }}
                        transition={{ duration: 0.08, repeat: Infinity }}
                      />
                    )}
                    {/* Exact Rocket Path from pts array: No stroke as requested */}
                    <path
                      d="M 0 -1 L 0.15 -0.7 L 0.15 0.8 L 0.4 1.0 L 0.15 0.9 L -0.15 0.9 L -0.4 1.0 L -0.15 0.8 L -0.15 -0.7 Z"
                      fill={previewBody.color}
                      strokeLinejoin="round"
                    />
                  </motion.svg>
                </div>
              ) : (
                <div
                  className="w-full h-full rounded-full shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
                  style={{
                    backgroundColor: previewBody.color,
                    boxShadow: isTriggered ? `0 0 50px ${previewBody.color}66, 0 30px 80px rgba(0,0,0,0.8)` : `0 10px 30px rgba(0,0,0,0.4)`
                  }}
                />
              )}
            </div>
          </motion.div>
        );
      })()}

      {/* Context Menu */}
      <motion.div
        ref={containerRef}
        key="context-menu"
        initial={{
          width: 40,
          height: 40,
          borderRadius: 40,
          x: (previewBody?.objectScreenPos?.x || x) - 20,
          y: (previewBody?.objectScreenPos?.y || y) - 20,
          opacity: 0,
          scale: 0.2
        }}
        animate={{
          width: isTriggered ? 190 : 40,
          height: isTriggered ? estimatedHeight : 40,
          borderRadius: isTriggered ? 12 : 40,
          x: isTriggered ? finalMenuX : (previewBody?.objectScreenPos?.x || x) - 20,
          y: isTriggered ? baseMenuY : (previewBody?.objectScreenPos?.y || y) - 20,
          opacity: isTriggered ? 1 : (previewBody ? 0 : 1),
          scale: isTriggered ? 1 : (previewBody ? 0.2 : 1.6)
        }}
        exit={{
          x: (previewBody?.objectScreenPos?.x || x) - 20,
          y: (previewBody?.objectScreenPos?.y || y) - 20,
          scale: 0.1,
          opacity: 0,
          width: 40,
          height: 40,
          transition: { duration: 0.2, ease: "easeIn" }
        }}
        transition={isTriggered ? {
          x: { type: "spring", damping: 25, stiffness: 350, delay: 0.12 },
          y: { type: "spring", damping: 25, stiffness: 350, delay: 0.12 },
          width: { type: "spring", damping: 25, stiffness: 350, delay: 0.12 },
          height: { type: "spring", damping: 25, stiffness: 350, delay: 0.12 },
          borderRadius: { duration: 0.4, ease: "easeInOut", delay: 0.12 },
          scale: { type: "spring", damping: 22, stiffness: 350, delay: 0.12 },
          opacity: { duration: 0.2, delay: 0.12 }
        } : {
          duration: 0.6,
          ease: "linear"
        }}
        onAnimationComplete={() => {
          if (isTriggered) {
            setIsReady(true);
            isReadyRef.current = true;
          }
        }}
        className="absolute bg-[#0c1016]/60 backdrop-blur-3xl border border-white/10 shadow-[0_25px_80px_rgba(0,0,0,0.8)] overflow-hidden pointer-events-auto flex flex-col"
      >
        <div className="relative w-full h-full">
          {/* Sphere State Content (Static Blur Sphere) */}
          {!previewBody && (
            <motion.div
              animate={{ opacity: isTriggered ? 0 : 1 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="w-1.5 h-1.5 bg-blue-400/50 rounded-full" />
            </motion.div>
          )}

          {/* Menu State Content */}
          <motion.div
            initial={false}
            animate={{ opacity: isTriggered ? 1 : 0 }}
            className="p-1.5 flex flex-col gap-1 w-full h-full"
          >
            {/* Quick Actions Row */}
            {quickActions && quickActions.length > 0 && (
              <div className="flex items-center gap-1.5 mb-1 px-1 pt-0.5 pb-2 border-b border-white/5">
                {quickActions.map((action, idx) => {
                  const qIdx = options.length + idx;
                  const isHovered = activeIndex === qIdx;
                  return (
                    <button
                      key={idx}
                      data-index={qIdx}
                      onClick={(e) => {
                        e.stopPropagation();
                        action.onClick();
                        onClose();
                      }}
                      className={`flex-1 h-9 flex items-center justify-center rounded-lg transition-none ${action.active
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : (isHovered ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400')
                        }`}
                      style={action.color && !action.active ? { color: action.color } : {}}
                    >
                      {React.cloneElement(action.icon as React.ReactElement, { size: 18 })}
                    </button>
                  );
                })}
              </div>
            )}

            {options.map((opt, i) => (
              <button
                key={opt.label}
                data-index={i}
                onPointerDown={() => isReady && setActiveIndex(i)}
                className={`w-full h-[42px] shrink-0 flex items-center justify-between px-3.5 rounded-lg group relative overflow-hidden transition-none ${activeIndex === i
                  ? 'bg-white/15 text-white'
                  : 'text-gray-400'
                  }`}
              >
                <span className="text-[12px] font-bold tracking-tight">
                  {opt.label}
                </span>
                <div className={`${activeIndex === i ? 'text-white' : 'text-gray-500'}`}>
                  {React.cloneElement(opt.icon as React.ReactElement, { size: 14 })}
                </div>
              </button>
            ))}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};
