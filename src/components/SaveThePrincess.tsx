import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { sfx } from '../utils/sounds';
import {
  ArrowLeft,
  RotateCcw,
  Sparkles,
  Shuffle,
  PlusCircle,
  Bomb,
  ShieldAlert,
  Trophy,
  Volume2,
  VolumeX,
  Flame
} from 'lucide-react';

export type GameColor = 'RED' | 'BLUE' | 'GREEN' | 'YELLOW' | 'PURPLE';

export interface DragonSegment {
  id: string;
  color: GameColor;
  hp: number;
  maxHp: number;
  progress: number; // Individual progress along track (0 to 1)
  targetProgress?: number; // Target progress for smooth elastic pull-back / contraction
}

export interface CannonItem {
  id: string;
  color: GameColor;
  ammo: number;
  maxAmmo: number;
  gridRow: number; // 0 is front row (exit), 1 is behind, 2 is furthest back
  gridCol: number;
  isUnlocked?: boolean;
}

export interface Projectile {
  id: string;
  color: GameColor;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetSegId: string;
  progress: number; // 0 to 1
}

export interface ParticleEffect {
  id: string;
  x: number;
  y: number;
  color: string;
  vx: number;
  vy: number;
  life: number; // 1 to 0
}

interface SaveThePrincessProps {
  onBack: () => void;
}

const COLOR_MAP: Record<
  GameColor,
  {
    name: string;
    primary: string;
    secondary: string;
    glow: string;
    border: string;
    accent: string;
  }
> = {
  RED: {
    name: 'Ruby Red',
    primary: '#ef4444',
    secondary: '#b91c1c',
    glow: 'rgba(239, 68, 68, 0.6)',
    border: '#7f1d1d',
    accent: '#fca5a5'
  },
  BLUE: {
    name: 'Sapphire Blue',
    primary: '#3b82f6',
    secondary: '#1d4ed8',
    glow: 'rgba(59, 130, 246, 0.6)',
    border: '#1e3a8a',
    accent: '#93c5fd'
  },
  GREEN: {
    name: 'Emerald Green',
    primary: '#10b981',
    secondary: '#047857',
    glow: 'rgba(16, 185, 129, 0.6)',
    border: '#064e3b',
    accent: '#6ee7b7'
  },
  YELLOW: {
    name: 'Topaz Amber',
    primary: '#f59e0b',
    secondary: '#b45309',
    glow: 'rgba(245, 158, 11, 0.6)',
    border: '#78350f',
    accent: '#fde68a'
  },
  PURPLE: {
    name: 'Amethyst Purple',
    primary: '#a855f7',
    secondary: '#7e22ce',
    glow: 'rgba(168, 85, 247, 0.6)',
    border: '#581c87',
    accent: '#d8b4fe'
  }
};

// Clean, progressive winding track across the 1920x1080 canvas
// Top-left offscreen entrance -> curves through top-middle -> curves down into central valley -> castle gate
const RAW_WAYPOINTS = [
  { x: -160, y: 130 }, // Off-screen entrance point
  { x: 140, y: 135 },
  { x: 440, y: 155 },
  { x: 740, y: 220 },
  { x: 980, y: 310 },
  { x: 1180, y: 350 },
  { x: 1330, y: 320 },
  { x: 1420, y: 360 },
  { x: 1470, y: 470 } // Castle Gate Entrance
];

// Pre-compute Catmull-Rom smooth spline with dense sampling
const RAW_SAMPLE_COUNT = 800;
const RAW_SAMPLES: { x: number; y: number }[] = [];

(() => {
  const pts = RAW_WAYPOINTS;
  for (let i = 0; i < RAW_SAMPLE_COUNT; i++) {
    const t = i / (RAW_SAMPLE_COUNT - 1);
    const pFloat = t * (pts.length - 1);
    const pIdx = Math.min(Math.floor(pFloat), pts.length - 2);
    const localT = pFloat - pIdx;

    const p0 = pts[Math.max(0, pIdx - 1)];
    const p1 = pts[pIdx];
    const p2 = pts[pIdx + 1];
    const p3 = pts[Math.min(pts.length - 1, pIdx + 2)];

    const tt = localT * localT;
    const ttt = tt * localT;

    const x =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * localT +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt);

    const y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * localT +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt);

    RAW_SAMPLES.push({ x, y });
  }
})();

// Build Arc-Length Table for EXACT uniform pixel spacing
let TOTAL_PATH_LENGTH = 0;
const ARC_LENGTHS: number[] = [0];
for (let i = 1; i < RAW_SAMPLES.length; i++) {
  const dx = RAW_SAMPLES[i].x - RAW_SAMPLES[i - 1].x;
  const dy = RAW_SAMPLES[i].y - RAW_SAMPLES[i - 1].y;
  TOTAL_PATH_LENGTH += Math.hypot(dx, dy);
  ARC_LENGTHS.push(TOTAL_PATH_LENGTH);
}

// Fixed spacing in exact pixels between adjacent segment centers (76px diameter with 2px separation = 78px)
const SEGMENT_GAP_PX = 78; // Exact center-to-center distance in pixels
const SEGMENT_GAP_T = SEGMENT_GAP_PX / TOTAL_PATH_LENGTH; // Fraction of total path

// Sample exact (x,y) by normalized progress (0 to 1) or even negative progress (offscreen entrance)
function getPointOnPath(t: number): { x: number; y: number } {
  const targetDist = t * TOTAL_PATH_LENGTH;

  if (targetDist <= 0) {
    // Extrapolate backwards before entrance
    const p0 = RAW_SAMPLES[0];
    const p1 = RAW_SAMPLES[1];
    const dirX = p1.x - p0.x;
    const dirY = p1.y - p0.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    return {
      x: p0.x + (dirX / dirLen) * targetDist,
      y: p0.y + (dirY / dirLen) * targetDist
    };
  }

  if (targetDist >= TOTAL_PATH_LENGTH) {
    return RAW_SAMPLES[RAW_SAMPLES.length - 1];
  }

  // Binary search arc length table
  let low = 0;
  let high = ARC_LENGTHS.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (ARC_LENGTHS[mid] <= targetDist) low = mid;
    else high = mid;
  }

  const segmentLen = ARC_LENGTHS[high] - ARC_LENGTHS[low];
  const frac = segmentLen > 0 ? (targetDist - ARC_LENGTHS[low]) / segmentLen : 0;
  const p0 = RAW_SAMPLES[low];
  const p1 = RAW_SAMPLES[high];

  return {
    x: p0.x + (p1.x - p0.x) * frac,
    y: p0.y + (p1.y - p0.y) * frac
  };
}

// Generate SVG smooth path d string
const SMOOTH_PATH_D = (() => {
  if (RAW_SAMPLES.length === 0) return '';
  return (
    `M ${RAW_SAMPLES[0].x.toFixed(1)},${RAW_SAMPLES[0].y.toFixed(1)} ` +
    RAW_SAMPLES.slice(1)
      .map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ')
  );
})();

export const SaveThePrincess: React.FC<SaveThePrincessProps> = ({ onBack }) => {
  // Game Configuration & Level State
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [combos, setCombos] = useState(0);
  const [dragonHeadDist, setDragonHeadDist] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isGameWon, setIsGameWon] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [screenShake, setScreenShake] = useState(false);

  // Powerups State
  const [shuffleCount, setShuffleCount] = useState(2);
  const [bombCount, setBombCount] = useState(1);
  const [extraSlotsUnlocked, setExtraSlotsUnlocked] = useState(0); // 0 = 5 slots, 1 = 6 slots, 2 = 7 slots
  const totalDeckSlots = 5 + extraSlotsUnlocked;

  // Active Game Entities
  const [dragonSegments, setDragonSegments] = useState<DragonSegment[]>([]);
  const [gridCannons, setGridCannons] = useState<CannonItem[]>([]);
  const [deckCannons, setDeckCannons] = useState<(CannonItem | null)[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [particles, setParticles] = useState<ParticleEffect[]>([]);

  // Refs for continuous animation loop & timing
  const lastTimeRef = useRef<number>(performance.now());
  const dragonSpeed = 0.0035 + (level - 1) * 0.0006; // steady creeping speed per second
  const isFiringRef = useRef<boolean>(false);
  const dragonSegmentsRef = useRef<DragonSegment[]>([]);
  dragonSegmentsRef.current = dragonSegments;

  // Level Generator
  const initLevel = useCallback(
    (lvl: number) => {
      const colors: GameColor[] = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE'];
      const activeColors = colors.slice(0, Math.min(3 + Math.floor((lvl - 1) / 2), 5));

      // 1. Generate Dragon Segments starting from outside the screen (entering slowly from the left entrance)
      const segmentCount = 6 + lvl * 2;
      const initialHeadPos = 0.02; // Start just entering the screen
      const newSegments: DragonSegment[] = [];

      for (let i = 0; i < segmentCount; i++) {
        const color = activeColors[Math.floor(Math.random() * activeColors.length)];
        const hp = 3 + Math.floor(Math.random() * 4); // 3 to 6 HP
        const segProgress = initialHeadPos - i * SEGMENT_GAP_T;
        newSegments.push({
          id: `seg_${lvl}_${i}_${Date.now()}`,
          color,
          hp,
          maxHp: hp,
          progress: segProgress,
          targetProgress: segProgress
        });
      }

      // 2. Count total HP per color to balance Cannon supply
      const colorDemands: Record<GameColor, number> = {
        RED: 0,
        BLUE: 0,
        GREEN: 0,
        YELLOW: 0,
        PURPLE: 0
      };
      newSegments.forEach((seg) => {
        colorDemands[seg.color] += seg.hp;
      });

      // 3. Generate Cannons into a 3 rows x 5 cols Parking Bay Matrix
      const newCannons: CannonItem[] = [];
      let cannonId = 0;
      const rows = 3;
      const cols = 5;

      // Flatten list of required colored cannons with ammo
      const cannonPool: { color: GameColor; ammo: number }[] = [];
      Object.entries(colorDemands).forEach(([colStr, totalHp]) => {
        const color = colStr as GameColor;
        let hpLeft = totalHp;
        while (hpLeft > 0) {
          const ammo = Math.min(hpLeft, 3 + Math.floor(Math.random() * 3));
          cannonPool.push({ color, ammo });
          hpLeft -= ammo;
        }
      });

      // Fill remaining parking grid spots with extra backup ammo
      while (cannonPool.length < rows * cols) {
        const color = activeColors[Math.floor(Math.random() * activeColors.length)];
        cannonPool.push({ color, ammo: 4 });
      }

      // Shuffle pool
      cannonPool.sort(() => Math.random() - 0.5);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const item = cannonPool.pop() || { color: 'RED', ammo: 3 };
          newCannons.push({
            id: `cannon_${lvl}_${cannonId++}`,
            color: item.color,
            ammo: item.ammo,
            maxAmmo: item.ammo,
            gridRow: r, // 0 is front row (exit), 1 is middle, 2 is back
            gridCol: c
          });
        }
      }

      setDragonSegments(newSegments);
      setGridCannons(newCannons);
      setDeckCannons(Array(5 + extraSlotsUnlocked).fill(null));
      setDragonHeadDist(initialHeadPos);
      setIsGameOver(false);
      setIsGameWon(false);
      setCombos(0);
      setProjectiles([]);
    },
    [extraSlotsUnlocked]
  );

  // Initialize level on mount / level change
  useEffect(() => {
    initLevel(level);
  }, [level, initLevel]);

  // Check if a cannon on the grid is blocked by any cannon in front of it (lower row index in same column)
  const isCannonBlocked = useCallback(
    (cannon: CannonItem): boolean => {
      // Row 0 is the front exit lane, never blocked from the front
      if (cannon.gridRow === 0) return false;
      // If any other cannon exists in the same column with a strictly smaller row number (closer to exit), it is blocked!
      return gridCannons.some(
        (other) =>
          other.id !== cannon.id &&
          other.gridCol === cannon.gridCol &&
          other.gridRow < cannon.gridRow
      );
    },
    [gridCannons]
  );

  // Trigger Screen Shake
  const triggerScreenShake = () => {
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 300);
  };

  // Spawn visual particles
  const spawnExplosionParticles = (x: number, y: number, colorHex: string) => {
    const newParticles: ParticleEffect[] = [];
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      newParticles.push({
        id: `p_${Date.now()}_${Math.random()}`,
        x,
        y,
        color: colorHex,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0
      });
    }
    setParticles((prev) => [...prev, ...newParticles]);
  };

  // Move Cannon from Grid to Deck
  const handleSelectCannon = (cannon: CannonItem) => {
    if (isGameOver || isGameWon) return;

    if (isCannonBlocked(cannon)) {
      if (!isMuted) sfx.playBlocked();
      return;
    }

    // Find first empty slot in deck
    const emptySlotIdx = deckCannons.findIndex((slot) => slot === null);
    if (emptySlotIdx === -1) {
      if (!isMuted) sfx.playBlocked();
      return;
    }

    if (!isMuted) sfx.playCannonSlide();

    // Remove from grid
    setGridCannons((prev) => prev.filter((c) => c.id !== cannon.id));

    // Place into deck
    setDeckCannons((prev) => {
      const next = [...prev];
      next[emptySlotIdx] = cannon;
      return next;
    });
  };

  // POWERUP: Shuffle Board
  const handleShuffleBoard = () => {
    if (shuffleCount <= 0 || gridCannons.length === 0 || isGameOver || isGameWon) return;
    setShuffleCount((prev) => prev - 1);
    if (!isMuted) sfx.playPop();

    setGridCannons((prev) => {
      const positions = prev.map((c) => ({ row: c.gridRow, col: c.gridCol }));
      positions.sort(() => Math.random() - 0.5);
      return prev.map((c, i) => ({
        ...c,
        gridRow: positions[i].row,
        gridCol: positions[i].col
      }));
    });
  };

  // POWERUP: Extra Slot
  const handleUnlockSlot = () => {
    if (extraSlotsUnlocked >= 2 || isGameOver || isGameWon) return;
    sfx.playCombo();
    setExtraSlotsUnlocked((prev) => prev + 1);
    setDeckCannons((prev) => [...prev, null]);
  };

  // POWERUP: Princess Magic Bomb (Destroys the leading segment)
  const handlePrincessBomb = () => {
    if (bombCount <= 0 || dragonSegments.length === 0 || isGameOver || isGameWon) return;
    setBombCount((prev) => prev - 1);
    if (!isMuted) sfx.playBomb();
    triggerScreenShake();

    // Destroy front-most segment instantly
    setDragonSegments((prev) => {
      if (prev.length === 0) return prev;
      const targetSeg = prev[0];
      const pos = getPointOnPath(targetSeg.progress);
      spawnExplosionParticles(pos.x, pos.y, COLOR_MAP[targetSeg.color].primary);
      setScore((s) => s + 500);

      // Remaining segments: front detached parts will smoothly pull back toward tail in animation loop
      return prev.slice(1);
    });
  };

  // MAIN GAME LOOP (Continuous Dragon march, Elastic Reconnection, Multi-Node Targeting)
  useEffect(() => {
    let animationFrameId: number;

    const gameTick = (time: number) => {
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05); // cap delta time
      lastTimeRef.current = time;

      if (!isGameOver && !isGameWon) {
        const currentSegs = dragonSegmentsRef.current;

        if (currentSegs.length > 0) {
          // 1. Advance Dragon & Smooth Elastic Body Compression
          const tailIdx = currentSegs.length - 1;
          const updated = currentSegs.map((seg) => ({
            ...seg,
            progress: seg.progress + dragonSpeed * dt
          }));

          // Pull-back / Reconnection Physics:
          // In Save the Princess: Dragon Out / Zuma mechanics:
          // When a middle segment is removed, every segment in front of the gap pulls back rapidly towards the tail!
          for (let i = tailIdx - 1; i >= 0; i--) {
            const behindSeg = updated[i + 1];
            const desiredProgress = behindSeg.progress + SEGMENT_GAP_T;

            // If front segment is further ahead than ideal gap, pull it back vigorously (speed 0.8 / sec)
            if (updated[i].progress > desiredProgress) {
              const pullAmount = 0.8 * dt;
              updated[i].progress = Math.max(
                desiredProgress,
                updated[i].progress - pullAmount
              );
            }
          }

          const headPos = updated[0].progress;
          setDragonHeadDist(headPos);

          // Update ref & React state
          dragonSegmentsRef.current = updated;
          setDragonSegments(updated);

          // Dragon reaches Castle Gate check
          if (headPos >= 0.94) {
            setIsGameOver(true);
            if (!isMuted) sfx.playGameOver();
            return;
          }
        } else {
          // Dragon destroyed win check
          setIsGameWon(true);
          if (!isMuted) sfx.playVictory();
          confetti({
            particleCount: 120,
            spread: 90,
            origin: { y: 0.5 }
          });
          return;
        }

        // 2. Cascade Firing from Deck (CAN SHOOT ANY MATCHING NODE IN THE ENTIRE DRAGON BODY)
        if (currentSegs.length > 0 && !isFiringRef.current) {
          let matchedCannonIdx = -1;
          let targetSegmentIdx = -1;

          for (let dIdx = 0; dIdx < deckCannons.length; dIdx++) {
            const cannon = deckCannons[dIdx];
            if (cannon && cannon.ammo > 0) {
              // Find matching segment on dragon (priority: front-most matching segment)
              const sIdx = currentSegs.findIndex((seg) => seg.color === cannon.color);
              if (sIdx !== -1) {
                matchedCannonIdx = dIdx;
                targetSegmentIdx = sIdx;
                break;
              }
            }
          }

          if (matchedCannonIdx !== -1 && targetSegmentIdx !== -1) {
            isFiringRef.current = true;
            const shootingCannon = deckCannons[matchedCannonIdx]!;
            const targetSeg = currentSegs[targetSegmentIdx];

            // Calculate deck slot coordinates on screen (relative to 1920x1080 canvas)
            const deckSlotWidth = 120;
            const deckSlotGap = 20;
            const startDeckX =
              960 - (totalDeckSlots * (deckSlotWidth + deckSlotGap) - deckSlotGap) / 2;
            const cannonX =
              startDeckX + matchedCannonIdx * (deckSlotWidth + deckSlotGap) + deckSlotWidth / 2;
            const cannonY = 720;

            const targetPos = getPointOnPath(targetSeg.progress);

            if (!isMuted) sfx.playCannonFire();

            // Spawn projectile
            const projId = `proj_${Date.now()}`;
            setProjectiles((prev) => [
              ...prev,
              {
                id: projId,
                color: shootingCannon.color,
                startX: cannonX,
                startY: cannonY,
                targetX: targetPos.x,
                targetY: targetPos.y,
                targetSegId: targetSeg.id,
                progress: 0
              }
            ]);

            // Rapid fire delay between shots
            setTimeout(() => {
              const segsNow = dragonSegmentsRef.current;
              const sIndex = segsNow.findIndex((s) => s.id === targetSeg.id);

              if (sIndex !== -1) {
                const currentTarget = segsNow[sIndex];
                const newHp = currentTarget.hp - 1;
                const pos = getPointOnPath(currentTarget.progress);

                spawnExplosionParticles(pos.x, pos.y, COLOR_MAP[currentTarget.color].accent);

                if (newHp <= 0) {
                  // Segment destroyed!
                  if (!isMuted) sfx.playSegmentExplode();
                  spawnExplosionParticles(pos.x, pos.y, COLOR_MAP[currentTarget.color].primary);
                  setScore((s) => s + 150);
                  setCombos((c) => {
                    const nextC = c + 1;
                    if (nextC > 1 && !isMuted) sfx.playCombo();
                    return nextC;
                  });

                  // Remove destroyed segment immediately from ref
                  const remaining = segsNow.filter((s) => s.id !== targetSeg.id);
                  dragonSegmentsRef.current = remaining;
                  setDragonSegments(remaining);
                } else {
                  const updatedSegs = [...segsNow];
                  updatedSegs[sIndex] = { ...currentTarget, hp: newHp };
                  dragonSegmentsRef.current = updatedSegs;
                  setDragonSegments(updatedSegs);
                }
              }

              setDeckCannons((prevDeck) => {
                const nextDeck = [...prevDeck];
                const c = nextDeck[matchedCannonIdx];
                if (!c) return nextDeck;
                const newAmmo = c.ammo - 1;
                if (newAmmo <= 0) {
                  nextDeck[matchedCannonIdx] = null;
                } else {
                  nextDeck[matchedCannonIdx] = { ...c, ammo: newAmmo };
                }
                return nextDeck;
              });

              isFiringRef.current = false;
            }, 120);
          } else {
            // Check for Deck Jam / Loss condition
            const isDeckFull = deckCannons.every((slot) => slot !== null);
            if (isDeckFull) {
              const anyCanShoot = deckCannons.some((c) =>
                c ? currentSegs.some((s) => s.color === c.color) : false
              );
              if (!anyCanShoot && bombCount === 0 && extraSlotsUnlocked >= 2) {
                setIsGameOver(true);
                if (!isMuted) sfx.playGameOver();
              }
            }
          }
        }
      }

      // 3. Update active projectiles
      setProjectiles((prev) =>
        prev
          .map((p) => ({ ...p, progress: p.progress + dt * 7.5 }))
          .filter((p) => p.progress < 1)
      );

      // 4. Update particles
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.3,
            life: p.life - dt * 2.5
          }))
          .filter((p) => p.life > 0)
      );

      animationFrameId = requestAnimationFrame(gameTick);
    };

    lastTimeRef.current = performance.now();
    animationFrameId = requestAnimationFrame(gameTick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    deckCannons,
    isGameOver,
    isGameWon,
    isMuted,
    dragonSpeed,
    totalDeckSlots,
    bombCount,
    extraSlotsUnlocked
  ]);

  return (
    <div
      className={`game-viewport ${screenShake ? 'animate-shake' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 60%, #311042 100%)',
        overflow: 'hidden',
        fontFamily: "'Fredoka', 'Nunito', sans-serif"
      }}
    >
      {/* ========================================================================= */}
      {/* 2.5D SVG BACKGROUND WORLD: CASTLE, PATH, MOUNTAINS & PRINCESS TOWER */}
      {/* ========================================================================= */}
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1
        }}
      >
        <defs>
          <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0f172a" />
            <stop offset="60%" stopColor="#1e1b4b" />
            <stop offset="100%" stopColor="#2e1065" />
          </linearGradient>

          <linearGradient id="groundGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="50%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>

          <linearGradient id="pathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#ef4444" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0.8" />
          </linearGradient>

          <filter id="glowFilter" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Sky / Dark Fantasy Arena */}
        <rect width="1920" height="1080" fill="url(#skyGrad)" />

        {/* Distant Spire Mountains */}
        <path d="M 0,400 L 250,220 L 500,420 L 800,180 L 1150,450 L 1500,210 L 1920,380 L 1920,1080 L 0,1080 Z" fill="#111827" opacity="0.7" />
        <path d="M 0,460 L 320,310 L 640,480 L 980,290 L 1320,510 L 1700,320 L 1920,440 L 1920,1080 L 0,1080 Z" fill="#1e1b4b" opacity="0.9" />

        {/* Castle / Princess Sanctuary at the right end */}
        <g transform="translate(1420, 310)">
          {/* Fortress Wall */}
          <rect x="0" y="80" width="460" height="320" rx="16" fill="#334155" stroke="#475569" strokeWidth="8" />
          {/* Wall Battlements */}
          <rect x="20" y="50" width="60" height="40" rx="6" fill="#475569" />
          <rect x="110" y="50" width="60" height="40" rx="6" fill="#475569" />
          <rect x="200" y="50" width="60" height="40" rx="6" fill="#475569" />
          <rect x="290" y="50" width="60" height="40" rx="6" fill="#475569" />
          <rect x="380" y="50" width="60" height="40" rx="6" fill="#475569" />

          {/* High Princess Tower */}
          <rect x="250" y="-180" width="160" height="260" rx="12" fill="#475569" stroke="#64748b" strokeWidth="6" />
          {/* Tower Conical Roof */}
          <polygon points="230,-180 330,-280 430,-180" fill="#ec4899" stroke="#db2777" strokeWidth="6" />
          {/* Castle Flag */}
          <line x1="330" y1="-280" x2="330" y2="-320" stroke="#fcd34d" strokeWidth="4" />
          <polygon points="330,-320 380,-305 330,-290" fill="#f43f5e" />

          {/* Princess Window & Princess Character */}
          <rect x="290" y="-120" width="80" height="110" rx="40" fill="#1e1b4b" stroke="#f472b6" strokeWidth="6" />
          <g transform="translate(330, -50)">
            {/* Princess Crown & Hair */}
            <circle cx="0" cy="-25" r="18" fill="#fde047" />
            <polygon points="-12,-38 -6,-48 0,-40 6,-48 12,-38" fill="#fbbf24" stroke="#f59e0b" strokeWidth="2" />
            {/* Princess Dress */}
            <path d="M -18,15 Q 0,-15 18,15 Z" fill="#ec4899" />
            {/* Princess Face */}
            <circle cx="0" cy="-20" r="14" fill="#fed7aa" />
            <circle cx="-5" cy="-22" r="2.5" fill="#431407" />
            <circle cx="5" cy="-22" r="2.5" fill="#431407" />
            {/* Scared / Happy Mouth */}
            <path
              d={dragonHeadDist > 0.65 ? 'M -4,-12 Q 0,-17 4,-12' : 'M -5,-14 Q 0,-8 5,-14'}
              fill="none"
              stroke="#be185d"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {/* Princess Hands waving */}
            <circle cx="-16" cy={Math.sin(Date.now() / 200) * 4} r="5" fill="#fed7aa" />
            <circle cx="16" cy={-Math.sin(Date.now() / 200) * 4} r="5" fill="#fed7aa" />
          </g>

          {/* Castle Gate (Dragon Target) */}
          <rect x="40" y="150" width="130" height="190" rx="60" fill="#0f172a" stroke="#e11d48" strokeWidth="6" strokeDasharray="10 6" />
          <path d="M 40,240 L 170,240 M 105,150 L 105,340" stroke="#64748b" strokeWidth="4" />
        </g>

        {/* Dragon Marching Track Pathway - Smooth Bezier Spline */}
        <path
          d={SMOOTH_PATH_D}
          fill="none"
          stroke="url(#pathGrad)"
          strokeWidth="74"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.35"
        />
        <path
          d={SMOOTH_PATH_D}
          fill="none"
          stroke="#334155"
          strokeWidth="48"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={SMOOTH_PATH_D}
          fill="none"
          stroke="#fde047"
          strokeWidth="6"
          strokeDasharray="16 16"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </svg>

      {/* ========================================================================= */}
      {/* DYNAMIC DRAGON ENTITY (MARCHING SEGMENTS ALONG SPLINE) */}
      {/* ========================================================================= */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 10
        }}
      >
        {dragonSegments.map((seg, idx) => {
          // Use individual segment progress (with elastic recoil connection)
          const pos = getPointOnPath(seg.progress);
          const isHead = idx === 0;
          const colorMeta = COLOR_MAP[seg.color];

          // Use percentage coordinates to stay 100% matched with SVG viewBox (1920x1080)
          const leftPercent = (pos.x / 1920) * 100;
          const topPercent = (pos.y / 1080) * 100;

          return (
            <div
              key={seg.id}
              style={{
                position: 'absolute',
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                transform: 'translate(-50%, -50%)',
                width: isHead ? '92px' : '76px',
                height: isHead ? '92px' : '76px',
                borderRadius: '50%',
                background: `radial-gradient(circle at 35% 30%, ${colorMeta.accent}, ${colorMeta.primary} 60%, ${colorMeta.secondary} 100%)`,
                boxShadow: `0 8px 24px ${colorMeta.glow}, inset 0 -4px 8px ${colorMeta.border}`,
                border: isHead ? '4px solid #ffffff' : `3px solid ${colorMeta.accent}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: isHead ? '26px' : '20px',
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                transition: 'transform 0.05s linear'
              }}
            >
              {/* Dragon Head Features */}
              {isHead && (
                <>
                  {/* Horns */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '-18px',
                      left: '8px',
                      width: '14px',
                      height: '24px',
                      background: '#fbbf24',
                      borderRadius: '8px 8px 0 0',
                      transform: 'rotate(-25deg)',
                      boxShadow: '0 0 8px #f59e0b'
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: '-18px',
                      right: '8px',
                      width: '14px',
                      height: '24px',
                      background: '#fbbf24',
                      borderRadius: '8px 8px 0 0',
                      transform: 'rotate(25deg)',
                      boxShadow: '0 0 8px #f59e0b'
                    }}
                  />

                  {/* Fierce Eyes */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '20px',
                      left: '18px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '14px',
                        background: '#000000',
                        borderRadius: '50%'
                      }}
                    />
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: '20px',
                      right: '18px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '14px',
                        background: '#000000',
                        borderRadius: '50%'
                      }}
                    />
                  </div>
                </>
              )}

              {/* HP Badge / Number */}
              <div
                style={{
                  position: 'relative',
                  marginTop: isHead ? '26px' : '0px',
                  background: 'rgba(0, 0, 0, 0.45)',
                  padding: '2px 10px',
                  borderRadius: '12px',
                  border: '1.5px solid rgba(255,255,255,0.4)'
                }}
              >
                {seg.hp}
              </div>
            </div>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* ACTIVE PROJECTILES & EXPLOSION PARTICLES */}
      {/* ========================================================================= */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 15
        }}
      >
        {projectiles.map((p) => {
          const curX = p.startX + (p.targetX - p.startX) * p.progress;
          const curY = p.startY + (p.targetY - p.startY) * p.progress;
          const colorMeta = COLOR_MAP[p.color];
          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: `${(curX / 1920) * 100}%`,
                top: `${(curY / 1080) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: colorMeta.primary,
                boxShadow: `0 0 16px ${colorMeta.glow}, 0 0 24px #ffffff`,
                border: '3px solid #ffffff'
              }}
            />
          );
        })}

        {particles.map((pt) => (
          <div
            key={pt.id}
            style={{
              position: 'absolute',
              left: `${(pt.x / 1920) * 100}%`,
              top: `${(pt.y / 1080) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: `${6 * pt.life}px`,
              height: `${6 * pt.life}px`,
              borderRadius: '50%',
              background: pt.color,
              opacity: pt.life,
              boxShadow: `0 0 8px ${pt.color}`
            }}
          />
        ))}
      </div>

      {/* ========================================================================= */}
      {/* TOP HEADER: LEVEL, DANGER METER, SCORE & SOUND */}
      {/* ========================================================================= */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 36,
          right: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 30,
          pointerEvents: 'auto'
        }}
      >
        {/* Back & Level Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => {
              if (!isMuted) sfx.playPop();
              onBack();
            }}
            className="btn-3d"
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, #475569 0%, #1e293b 100%)',
              boxShadow: '0 6px 0 #0f172a, 0 10px 18px rgba(0,0,0,0.5)',
              border: '2px solid #94a3b8',
              color: '#ffffff'
            }}
          >
            <ArrowLeft size={28} />
          </button>

          <div
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              padding: '8px 24px',
              borderRadius: '24px',
              border: '2px solid #475569',
              boxShadow: '0 6px 14px rgba(0,0,0,0.4)',
              color: '#ffffff',
              fontSize: '20px',
              fontWeight: 800
            }}
          >
            LEVEL <span style={{ color: '#facc15' }}>{level}</span>
          </div>
        </div>

        {/* Dragon Danger Distance Bar */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            width: '420px'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: dragonHeadDist > 0.65 ? '#ef4444' : '#94a3b8',
              fontSize: '15px',
              fontWeight: 800,
              letterSpacing: '1px'
            }}
          >
            <ShieldAlert size={18} />
            DRAGON PROXIMITY
            {dragonHeadDist > 0.65 && (
              <span className="animate-pulse" style={{ color: '#f87171' }}>
                (DANGER!)
              </span>
            )}
          </div>
          <div
            style={{
              width: '100%',
              height: '18px',
              borderRadius: '12px',
              background: '#0f172a',
              border: '2px solid #334155',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            <div
              style={{
                width: `${Math.min(100, (dragonHeadDist / 0.94) * 100)}%`,
                height: '100%',
                background:
                  dragonHeadDist > 0.65
                    ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                    : 'linear-gradient(90deg, #3b82f6, #10b981)',
                transition: 'width 0.1s linear',
                boxShadow:
                  dragonHeadDist > 0.65 ? '0 0 12px #ef4444' : '0 0 12px #10b981'
              }}
            />
          </div>
        </div>

        {/* Score & Combo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {combos > 1 && (
            <div
              className="animate-pop"
              style={{
                background: 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)',
                padding: '6px 16px',
                borderRadius: '16px',
                border: '2px solid #fde68a',
                boxShadow: '0 0 16px rgba(245, 158, 11, 0.6)',
                color: '#ffffff',
                fontSize: '16px',
                fontWeight: 900
              }}
            >
              🔥 {combos}x COMBO!
            </div>
          )}

          <div
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              padding: '8px 24px',
              borderRadius: '24px',
              border: '2px solid #475569',
              boxShadow: '0 6px 14px rgba(0,0,0,0.4)',
              color: '#ffffff',
              fontSize: '20px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Sparkles size={20} color="#facc15" />
            <span>{score}</span>
          </div>

          <button
            onClick={() => setIsMuted((m) => !m)}
            className="btn-3d"
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, #475569 0%, #1e293b 100%)',
              boxShadow: '0 6px 0 #0f172a, 0 10px 18px rgba(0,0,0,0.5)',
              border: '2px solid #94a3b8',
              color: '#ffffff'
            }}
          >
            {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BOTTOM PLAY AREA: ACTIVE FIRING DECK + PARKING GRID MATRIX */}
      {/* ========================================================================= */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          zIndex: 25,
          pointerEvents: 'auto'
        }}
      >
        {/* ACTIVE FIRING DECK (5 to 7 SLOTS) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 800,
              color: '#94a3b8',
              letterSpacing: '1.5px',
              textTransform: 'uppercase'
            }}
          >
            ACTIVE FIRING DECK ({deckCannons.filter(Boolean).length}/{totalDeckSlots})
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '12px 24px',
              background: 'rgba(15, 23, 42, 0.85)',
              borderRadius: '24px',
              border: '3px solid #334155',
              boxShadow: '0 12px 32px rgba(0,0,0,0.6), inset 0 2px 4px rgba(255,255,255,0.1)',
              backdropFilter: 'blur(10px)'
            }}
          >
            {deckCannons.map((cannon, idx) => {
              const currentHead = dragonSegments[0];
              const isShooting = cannon && currentHead && cannon.color === currentHead.color;

              return (
                <div
                  key={`deck_slot_${idx}`}
                  style={{
                    width: '100px',
                    height: '110px',
                    borderRadius: '16px',
                    background: cannon
                      ? `linear-gradient(180deg, ${COLOR_MAP[cannon.color].primary} 0%, ${
                          COLOR_MAP[cannon.color].secondary
                        } 100%)`
                      : 'rgba(30, 41, 59, 0.5)',
                    border: cannon
                      ? `3px solid ${COLOR_MAP[cannon.color].accent}`
                      : '2px dashed #475569',
                    boxShadow: cannon
                      ? isShooting
                        ? `0 0 28px ${COLOR_MAP[cannon.color].glow}, 0 8px 16px rgba(0,0,0,0.5)`
                        : `0 8px 16px rgba(0,0,0,0.4)`
                      : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }}
                >
                  {cannon ? (
                    <>
                      {/* Cannon Top Barrel */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '-12px',
                          width: '26px',
                          height: '24px',
                          background: '#1e293b',
                          border: '3px solid #64748b',
                          borderRadius: '6px 6px 0 0',
                          boxShadow: '0 -2px 6px rgba(0,0,0,0.5)'
                        }}
                      />

                      {/* Cannon Wheels */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '6px',
                          left: '6px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#0f172a',
                          border: '2px solid #94a3b8'
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '6px',
                          right: '6px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#0f172a',
                          border: '2px solid #94a3b8'
                        }}
                      />

                      {/* Status / Ammo count */}
                      <div
                        style={{
                          color: '#ffffff',
                          fontWeight: 900,
                          fontSize: '24px',
                          textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                        }}
                      >
                        {cannon.ammo}
                      </div>

                      {/* Firing Flame Indicator */}
                      {isShooting && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '-24px',
                            color: '#fde047',
                            animation: 'calmSparkleGlow 0.3s infinite'
                          }}
                        >
                          <Flame size={24} fill="#f59e0b" />
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#475569', fontSize: '13px', fontWeight: 800 }}>
                      SLOT {idx + 1}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PARKING MATRIX & POWERUPS CONTAINER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '32px'
          }}
        >
          {/* POWER-UPS SIDEBAR */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            {/* Shuffle Tool */}
            <button
              onClick={handleShuffleBoard}
              disabled={shuffleCount <= 0}
              className="btn-3d"
              style={{
                width: '74px',
                height: '74px',
                borderRadius: '20px',
                background:
                  shuffleCount > 0
                    ? 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)'
                    : '#334155',
                boxShadow:
                  shuffleCount > 0
                    ? '0 6px 0 #1e3a8a, 0 8px 16px rgba(0,0,0,0.4)'
                    : 'none',
                border: '2px solid #93c5fd',
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                opacity: shuffleCount > 0 ? 1 : 0.4
              }}
            >
              <Shuffle size={24} />
              <span style={{ fontSize: '11px', fontWeight: 900 }}>SHUFFLE ({shuffleCount})</span>
            </button>

            {/* Extra Slot Tool */}
            <button
              onClick={handleUnlockSlot}
              disabled={extraSlotsUnlocked >= 2}
              className="btn-3d"
              style={{
                width: '74px',
                height: '74px',
                borderRadius: '20px',
                background:
                  extraSlotsUnlocked < 2
                    ? 'linear-gradient(180deg, #10b981 0%, #047857 100%)'
                    : '#334155',
                boxShadow:
                  extraSlotsUnlocked < 2
                    ? '0 6px 0 #064e3b, 0 8px 16px rgba(0,0,0,0.4)'
                    : 'none',
                border: '2px solid #6ee7b7',
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                opacity: extraSlotsUnlocked < 2 ? 1 : 0.4
              }}
            >
              <PlusCircle size={24} />
              <span style={{ fontSize: '11px', fontWeight: 900 }}>
                +SLOT ({2 - extraSlotsUnlocked})
              </span>
            </button>

            {/* Princess Magic Bomb */}
            <button
              onClick={handlePrincessBomb}
              disabled={bombCount <= 0}
              className="btn-3d"
              style={{
                width: '74px',
                height: '74px',
                borderRadius: '20px',
                background:
                  bombCount > 0
                    ? 'linear-gradient(180deg, #ec4899 0%, #be185d 100%)'
                    : '#334155',
                boxShadow:
                  bombCount > 0
                    ? '0 6px 0 #831843, 0 8px 16px rgba(0,0,0,0.4)'
                    : 'none',
                border: '2px solid #fbcfe8',
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                opacity: bombCount > 0 ? 1 : 0.4
              }}
            >
              <Bomb size={24} />
              <span style={{ fontSize: '11px', fontWeight: 900 }}>BOMB ({bombCount})</span>
            </button>
          </div>

          {/* PARKING BAY GRID (3 Rows x 5 Cols) */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '16px 24px',
              background: 'rgba(15, 23, 42, 0.9)',
              borderRadius: '24px',
              border: '3px solid #334155',
              boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
              position: 'relative'
            }}
          >
            {/* Exit Arrow Lane Marks */}
            <div
              style={{
                position: 'absolute',
                top: '-14px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#38bdf8',
                color: '#0f172a',
                padding: '2px 14px',
                borderRadius: '10px',
                fontSize: '11px',
                fontWeight: 900,
                letterSpacing: '1px'
              }}
            >
              ▲ EXIT TO FIRING DECK ▲
            </div>

            {[0, 1, 2].map((r) => (
              <div
                key={`grid_row_${r}`}
                style={{
                  display: 'flex',
                  gap: '14px'
                }}
              >
                {[0, 1, 2, 3, 4].map((c) => {
                  const cannon = gridCannons.find(
                    (item) => item.gridRow === r && item.gridCol === c
                  );
                  const blocked = cannon ? isCannonBlocked(cannon) : false;
                  const colorMeta = cannon ? COLOR_MAP[cannon.color] : null;

                  return (
                    <div
                      key={`grid_cell_${r}_${c}`}
                      onClick={() => cannon && handleSelectCannon(cannon)}
                      className={cannon && !blocked ? 'btn-3d' : ''}
                      style={{
                        width: '84px',
                        height: '84px',
                        borderRadius: '18px',
                        background: cannon
                          ? blocked
                            ? `linear-gradient(180deg, #475569 0%, #1e293b 100%)`
                            : `linear-gradient(180deg, ${colorMeta!.primary} 0%, ${
                                colorMeta!.secondary
                              } 100%)`
                          : 'rgba(30, 41, 59, 0.3)',
                        border: cannon
                          ? blocked
                            ? '2px solid #64748b'
                            : `3px solid ${colorMeta!.accent}`
                          : '2px dashed #1e293b',
                        boxShadow:
                          cannon && !blocked
                            ? `0 6px 0 ${colorMeta!.border}, 0 8px 16px rgba(0,0,0,0.4)`
                            : 'none',
                        cursor: cannon && !blocked ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        filter: blocked ? 'grayscale(0.7) brightness(0.6)' : 'none',
                        transition: 'transform 0.15s ease, filter 0.2s ease'
                      }}
                    >
                      {cannon && (
                        <>
                          {/* Barrel */}
                          <div
                            style={{
                              position: 'absolute',
                              top: '-8px',
                              width: '20px',
                              height: '18px',
                              background: '#1e293b',
                              border: '2px solid #64748b',
                              borderRadius: '4px 4px 0 0'
                            }}
                          />

                          {/* Ammo Count */}
                          <div
                            style={{
                              color: '#ffffff',
                              fontWeight: 900,
                              fontSize: '22px',
                              textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                            }}
                          >
                            {cannon.ammo}
                          </div>

                          {/* Lock Overlay if Blocked */}
                          {blocked && (
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: '16px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(0,0,0,0.35)',
                                color: '#94a3b8',
                                fontSize: '11px',
                                fontWeight: 900
                              }}
                            >
                              BLOCKED
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VICTORY MODAL */}
      {/* ========================================================================= */}
      {isGameWon && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            className="animate-pop"
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              padding: '40px 60px',
              borderRadius: '32px',
              border: '4px solid #facc15',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(250, 204, 21, 0.4)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '20px',
              maxWidth: '520px'
            }}
          >
            <Trophy size={80} color="#facc15" />
            <h2
              style={{
                fontSize: '36px',
                fontWeight: 900,
                color: '#ffffff',
                textShadow: '0 4px 10px rgba(0,0,0,0.5)'
              }}
            >
              PRINCESS RESCUED!
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: '18px', fontWeight: 600 }}>
              You blasted the dragon away and saved the kingdom!
            </p>

            <div
              style={{
                background: 'rgba(0,0,0,0.4)',
                padding: '12px 32px',
                borderRadius: '16px',
                color: '#fde047',
                fontSize: '24px',
                fontWeight: 900
              }}
            >
              SCORE: {score}
            </div>

            <button
              onClick={() => {
                if (!isMuted) sfx.playPop();
                setLevel((l) => l + 1);
              }}
              className="btn-3d"
              style={{
                marginTop: '12px',
                padding: '16px 48px',
                borderRadius: '24px',
                background: 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
                boxShadow: '0 8px 0 #14532d, 0 12px 24px rgba(0,0,0,0.5)',
                border: '3px solid #86efac',
                color: '#ffffff',
                fontSize: '22px',
                fontWeight: 900
              }}
            >
              NEXT LEVEL
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* GAME OVER MODAL */}
      {/* ========================================================================= */}
      {isGameOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            className="animate-pop"
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              padding: '40px 60px',
              borderRadius: '32px',
              border: '4px solid #ef4444',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(239, 68, 68, 0.4)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '20px',
              maxWidth: '520px'
            }}
          >
            <ShieldAlert size={80} color="#ef4444" />
            <h2
              style={{
                fontSize: '36px',
                fontWeight: 900,
                color: '#ffffff',
                textShadow: '0 4px 10px rgba(0,0,0,0.5)'
              }}
            >
              THE DRAGON WON!
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: '18px', fontWeight: 600 }}>
              {dragonHeadDist >= 0.94
                ? 'The dragon reached the castle gates!'
                : 'Your firing deck was completely jammed with no matches!'}
            </p>

            <button
              onClick={() => {
                if (!isMuted) sfx.playPop();
                initLevel(level);
              }}
              className="btn-3d"
              style={{
                marginTop: '12px',
                padding: '16px 48px',
                borderRadius: '24px',
                background: 'linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)',
                boxShadow: '0 8px 0 #7f1d1d, 0 12px 24px rgba(0,0,0,0.5)',
                border: '3px solid #fca5a5',
                color: '#ffffff',
                fontSize: '22px',
                fontWeight: 900,
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <RotateCcw size={24} />
              TRY AGAIN
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
