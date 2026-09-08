import React, { useState, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { sfx } from '../utils/sounds';
import { ArrowLeft, Star, Sparkles, RefreshCw, Lightbulb } from 'lucide-react';

interface ShrinkTheSnakeProps {
  onBack: () => void;
}

interface Question {
  id: number;
  text: string; // e.g. "8 + 5"
  fullEquation: string; // e.g. "8 + 5 = ?"
  a: number;
  b: number;
  op: '+' | '-' | '×' | '÷';
  answer: number;
  options: number[];
  baseHint: string;
}

const TOTAL_SEGMENTS = 5;

const SNAKE_PRAISES = [
  '“Great job!” 🌟',
  '“You got it!” 🎉',
  '“Awesome!” 🚀',
  '“Keep going!” 💪',
  '“You’re doing great!” ✨',
  '“Woohoo! I feel lighter!” 🐍'
];

export const ShrinkTheSnake: React.FC<ShrinkTheSnakeProps> = ({ onBack }) => {
  const [questionsList, setQuestionsList] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswerChecking, setIsAnswerChecking] = useState(false);
  const [isGameWon, setIsGameWon] = useState(false);
  const [shrinkingTailIdx, setShrinkingTailIdx] = useState<number | null>(null);

  // Snake speech bubble state
  const [snakeDialogue, setSnakeDialogue] = useState<string>(
    '“Solve the questions on my body to help me shrink!”'
  );
  const [snakeEmotion, setSnakeEmotion] = useState<'happy' | 'thinking' | 'cheering'>('happy');
  const [showHintCard, setShowHintCard] = useState(false);

  // Helper: create a single grade 5 question
  const createSingleQuestion = useCallback((id: number): Question => {
    const opTypes: ('+' | '-' | '×' | '÷')[] = ['+', '-', '×', '÷'];
    const chosenOp = opTypes[Math.floor(Math.random() * opTypes.length)];

    let a = 0;
    let b = 0;
    let answer = 0;
    let baseHint = '';

    if (chosenOp === '+') {
      a = Math.floor(Math.random() * 30) + 12;
      b = Math.floor(Math.random() * 25) + 11;
      answer = a + b;
      baseHint = `Break it down: Add tens (${Math.floor(a / 10) * 10} + ${Math.floor(b / 10) * 10} = ${
        Math.floor(a / 10) * 10 + Math.floor(b / 10) * 10
      }), then ones (${a % 10} + ${b % 10} = ${(a % 10) + (b % 10)})!`;
    } else if (chosenOp === '-') {
      b = Math.floor(Math.random() * 20) + 12;
      a = b + Math.floor(Math.random() * 30) + 10;
      answer = a - b;
      baseHint = `Start with ${a} and subtract in parts: first take away ${Math.floor(b / 10) * 10}, then take away ${b % 10}!`;
    } else if (chosenOp === '×') {
      a = Math.floor(Math.random() * 7) + 3; // 3 to 9
      b = Math.floor(Math.random() * 8) + 3; // 3 to 10
      answer = a * b;
      baseHint = `Think of ${a} equal groups of ${b}. Count by ${b}s ${a} times!`;
    } else {
      b = Math.floor(Math.random() * 7) + 3; // divisor: 3 to 9
      const quotient = Math.floor(Math.random() * 8) + 3; // quotient: 3 to 10
      a = b * quotient;
      answer = quotient;
      baseHint = `Ask yourself: What number multiplied by ${b} equals ${a}? ( __ × ${b} = ${a} )`;
    }

    // Generate 4 distinct plausible options
    const optionSet = new Set<number>();
    optionSet.add(answer);

    const offsets = [-2, 2, -1, 1, -10, 10, -5, 5, 3, -3, 4, -4];
    offsets.sort(() => Math.random() - 0.5);

    for (const offset of offsets) {
      const candidate = answer + offset;
      if (candidate > 0 && candidate !== answer) {
        optionSet.add(candidate);
      }
      if (optionSet.size >= 4) break;
    }

    let filler = 1;
    while (optionSet.size < 4) {
      if (!optionSet.has(answer + filler)) optionSet.add(answer + filler);
      filler++;
    }

    const options = Array.from(optionSet).sort(() => Math.random() - 0.5);

    return {
      id,
      text: `${a} ${chosenOp} ${b}`,
      fullEquation: `${a} ${chosenOp} ${b} = ?`,
      a,
      b,
      op: chosenOp,
      answer,
      options,
      baseHint
    };
  }, []);

  // Initialize snake with questions on its body sections
  const initializeGame = useCallback(() => {
    const list: Question[] = [];
    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      list.push(createSingleQuestion(i));
    }
    setQuestionsList(list);
    setCurrentIdx(0);
    setScore(0);
    setWrongAttempts(0);
    setSelectedOption(null);
    setIsAnswerChecking(false);
    setIsGameWon(false);
    setShrinkingTailIdx(null);
    setShowHintCard(false);
    setSnakeDialogue('“Solve the questions on my body to help me shrink!”');
    setSnakeEmotion('happy');
  }, [createSingleQuestion]);

  useEffect(() => {
    initializeGame();
  }, [initializeGame]);

  const activeQuestion = questionsList[currentIdx];
  const remainingCount = questionsList.length - currentIdx;

  // Handle player answer selection from the bottom choices
  const handleSelectOption = (opt: number) => {
    if (isAnswerChecking || isGameWon || !activeQuestion) return;

    setSelectedOption(opt);
    setIsAnswerChecking(true);

    if (opt === activeQuestion.answer) {
      // Correct!
      sfx.playCorrect();
      setScore((prev) => prev + 20);
      setSnakeEmotion('cheering');

      const praise = SNAKE_PRAISES[Math.floor(Math.random() * SNAKE_PRAISES.length)];
      setSnakeDialogue(praise);

      // Trigger the active tail section shrink animation
      setShrinkingTailIdx(currentIdx);

      confetti({
        particleCount: 60,
        spread: 80,
        origin: { y: 0.55 }
      });

      setTimeout(() => {
        const nextIdx = currentIdx + 1;
        setShrinkingTailIdx(null);
        setSelectedOption(null);
        setIsAnswerChecking(false);
        setWrongAttempts(0);
        setShowHintCard(false);

        if (nextIdx >= questionsList.length) {
          // Game Completed!
          setIsGameWon(true);
          sfx.playCorrect();
          setSnakeDialogue('“Hooray! My tail is completely shrunk and super cute! YOU WON! 🏆”');
          setSnakeEmotion('happy');
          confetti({
            particleCount: 140,
            spread: 120,
            origin: { y: 0.45 }
          });
        } else {
          setCurrentIdx(nextIdx);
        }
      }, 750);
    } else {
      // Wrong answer
      sfx.playGentleTryAgain();
      const newAttempts = wrongAttempts + 1;
      setWrongAttempts(newAttempts);
      setSnakeEmotion('thinking');

      if (newAttempts === 1) {
        setSnakeDialogue('“Almost! Try again.” 😊');
      } else if (newAttempts === 2) {
        setSnakeDialogue('“Think about the numbers carefully!” 💭');
        setShowHintCard(true);
      } else {
        setSnakeDialogue(`“Here’s a hint: ${activeQuestion.baseHint}” 💡`);
        setShowHintCard(true);
      }

      setTimeout(() => {
        setIsAnswerChecking(false);
        setSelectedOption(null);
      }, 900);
    }
  };

  // Cohesive anatomical paths for each state of remaining sections (5 -> 1)
  // Continuous smooth cubic beziers flowing seamlessly from head to tapered tail
  // Perfectly proportioned inside an expanded 1480x320 canvas with generous safety margins on both sides
  const SNAKE_STAGE_CONFIGS: Record<
    number,
    {
      bodyOutline: string;
      bodySkin: string;
      bellySkin: string;
      bellyStripes: string[];
      tailTip: { x: number; y: number; rot: number };
      questionPositions: { x: number; y: number; rot: number; color: string }[];
    }
  > = {
    5: {
      bodyOutline:
        'M 200,150 C 260,155 305,235 400,225 C 495,215 530,125 635,135 C 740,145 775,245 870,235 C 965,225 1005,135 1085,150 C 1135,160 1170,195 1195,195',
      bodySkin:
        'M 200,150 C 260,155 305,235 400,225 C 495,215 530,125 635,135 C 740,145 775,245 870,235 C 965,225 1005,135 1085,150 C 1135,160 1170,195 1195,195',
      bellySkin:
        'M 200,165 C 260,170 305,250 400,240 C 495,230 530,140 635,150 C 740,160 775,260 870,250 C 965,240 1005,150 1085,165 C 1135,175 1170,205 1195,200',
      bellyStripes: [
        'M 320,190 Q 340,215 360,195',
        'M 450,200 Q 470,175 490,190',
        'M 565,135 Q 585,160 605,140',
        'M 705,180 Q 725,205 745,190',
        'M 810,235 Q 830,210 850,225',
        'M 935,205 Q 955,180 975,195',
        'M 1035,145 Q 1055,170 1075,155'
      ],
      tailTip: { x: 1193, y: 194, rot: 5 },
      questionPositions: [
        { x: 380, y: 210, rot: -5, color: '#fef08a' },
        { x: 595, y: 140, rot: 8, color: '#fed7aa' },
        { x: 810, y: 220, rot: -8, color: '#fbcfe8' },
        { x: 995, y: 155, rot: 10, color: '#bfdbfe' },
        { x: 1135, y: 175, rot: 5, color: '#ddd6fe' }
      ]
    },
    4: {
      bodyOutline:
        'M 200,150 C 260,155 305,235 400,225 C 495,215 530,125 635,135 C 740,145 775,245 870,235 C 955,225 1010,165 1055,165',
      bodySkin:
        'M 200,150 C 260,155 305,235 400,225 C 495,215 530,125 635,135 C 740,145 775,245 870,235 C 955,225 1010,165 1055,165',
      bellySkin:
        'M 200,165 C 260,170 305,250 400,240 C 495,230 530,140 635,150 C 740,160 775,260 870,250 C 955,240 1010,180 1055,173',
      bellyStripes: [
        'M 320,190 Q 340,215 360,195',
        'M 450,200 Q 470,175 490,190',
        'M 565,135 Q 585,160 605,140',
        'M 705,180 Q 725,205 745,190',
        'M 810,235 Q 830,210 850,225',
        'M 935,205 Q 955,180 975,195'
      ],
      tailTip: { x: 1053, y: 165, rot: -8 },
      questionPositions: [
        { x: 380, y: 210, rot: -5, color: '#fef08a' },
        { x: 595, y: 140, rot: 8, color: '#fed7aa' },
        { x: 810, y: 220, rot: -8, color: '#fbcfe8' },
        { x: 980, y: 180, rot: -5, color: '#bfdbfe' }
      ]
    },
    3: {
      bodyOutline:
        'M 200,150 C 260,155 305,235 400,225 C 495,215 530,125 635,135 C 730,145 795,215 865,200',
      bodySkin:
        'M 200,150 C 260,155 305,235 400,225 C 495,215 530,125 635,135 C 730,145 795,215 865,200',
      bellySkin:
        'M 200,165 C 260,170 305,250 400,240 C 495,230 530,140 635,150 C 730,160 795,230 865,208',
      bellyStripes: [
        'M 320,190 Q 340,215 360,195',
        'M 450,200 Q 470,175 490,190',
        'M 565,135 Q 585,160 605,140',
        'M 705,180 Q 725,205 745,190'
      ],
      tailTip: { x: 863, y: 200, rot: -12 },
      questionPositions: [
        { x: 380, y: 210, rot: -5, color: '#fef08a' },
        { x: 595, y: 140, rot: 8, color: '#fed7aa' },
        { x: 775, y: 178, rot: 15, color: '#fbcfe8' }
      ]
    },
    2: {
      bodyOutline: 'M 200,150 C 260,155 305,235 400,225 C 495,215 560,155 655,165',
      bodySkin: 'M 200,150 C 260,155 305,235 400,225 C 495,215 560,155 655,165',
      bellySkin: 'M 200,165 C 260,170 305,250 400,240 C 495,230 560,170 655,172',
      bellyStripes: ['M 320,190 Q 340,215 360,195', 'M 450,200 Q 470,175 490,190', 'M 565,170 Q 585,190 605,175'],
      tailTip: { x: 653, y: 165, rot: -5 },
      questionPositions: [
        { x: 380, y: 210, rot: -5, color: '#fef08a' },
        { x: 565, y: 175, rot: -8, color: '#fed7aa' }
      ]
    },
    1: {
      bodyOutline: 'M 200,150 C 260,155 305,225 400,210 C 445,205 480,185 520,170',
      bodySkin: 'M 200,150 C 260,155 305,225 400,210 C 445,205 480,185 520,170',
      bellySkin: 'M 200,165 C 260,170 305,240 400,225 C 445,220 480,200 520,178',
      bellyStripes: ['M 310,185 Q 330,210 350,190', 'M 415,200 Q 435,180 455,195'],
      tailTip: { x: 518, y: 170, rot: -18 },
      questionPositions: [{ x: 370, y: 195, rot: 5, color: '#fef08a' }]
    }
  };

  const currentStage = Math.max(1, Math.min(5, remainingCount));
  const stageData = SNAKE_STAGE_CONFIGS[currentStage];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px 10px 24px',
        boxSizing: 'border-box',
        background: 'linear-gradient(180deg, #38bdf8 0%, #67e8f9 35%, #a7f3d0 70%, #34d399 100%)',
        fontFamily: "'Fredoka', 'Nunito', sans-serif"
      }}
    >
      {/* Cartoon Background Elements */}
      <div
        style={{ position: 'absolute', top: 30, left: '5%', fontSize: '4.5rem', opacity: 0.85, pointerEvents: 'none' }}
        className="animate-float"
      >
        ☁️
      </div>
      <div
        style={{ position: 'absolute', top: 60, right: '7%', fontSize: '5rem', opacity: 0.8, pointerEvents: 'none' }}
        className="animate-float"
      >
        ☁️
      </div>
      <div
        style={{ position: 'absolute', bottom: '130px', left: '3%', fontSize: '3rem', pointerEvents: 'none' }}
        className="animate-flower-sway"
      >
        🌸
      </div>
      <div style={{ position: 'absolute', bottom: '110px', left: '12%', fontSize: '2.4rem', pointerEvents: 'none' }}>
        🍄
      </div>
      <div
        style={{ position: 'absolute', bottom: '120px', left: '24%', fontSize: '2.8rem', pointerEvents: 'none' }}
        className="animate-flower-sway"
      >
        🌼
      </div>
      <div style={{ position: 'absolute', bottom: '115px', left: '38%', fontSize: '2.5rem', pointerEvents: 'none' }}>
        🌿
      </div>

      {/* ========================================================================= */}
      {/* 1. TOP HEADER HUD                                                         */}
      {/* ========================================================================= */}
      <div
        style={{
          width: '100%',
          maxWidth: '1600px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 20
        }}
      >
        {/* Back Button */}
        <button
          onClick={() => {
            sfx.playPop();
            onBack();
          }}
          className="btn-3d"
          style={{
            background: '#FFFFFF',
            color: '#0284c7',
            border: '3px solid #bae6fd',
            borderRadius: '9999px',
            padding: '8px 22px',
            fontSize: '1.2rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 5px 0 #7dd3fc'
          }}
        >
          <ArrowLeft size={22} /> Menu
        </button>

        {/* Title Badge */}
        <div
          style={{
            background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)',
            color: '#FFFFFF',
            padding: '7px 28px',
            borderRadius: '9999px',
            fontSize: '1.35rem',
            fontWeight: 900,
            boxShadow: '0 5px 0 #047857',
            border: '3px solid #6ee7b7',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            textShadow: '0 2px 0 #047857'
          }}
        >
          <span>🐍</span> Shrink the Snake
        </div>

        {/* Score & Segments Counter */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div
            style={{
              background: '#FFFFFF',
              color: '#047857',
              padding: '7px 20px',
              borderRadius: '9999px',
              fontSize: '1.15rem',
              fontWeight: 800,
              boxShadow: '0 5px 0 #a7f3d0',
              border: '2px solid #d1fae5',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            Tail Left: <span style={{ color: '#059669', fontSize: '1.3rem', fontWeight: 900 }}>{remainingCount} / {TOTAL_SEGMENTS}</span>
          </div>

          <div
            style={{
              background: '#fef08a',
              color: '#854d0e',
              padding: '7px 22px',
              borderRadius: '9999px',
              fontSize: '1.25rem',
              fontWeight: 800,
              boxShadow: '0 5px 0 #fde047',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '2px solid #fef9c3'
            }}
          >
            <Star size={20} fill="#ca8a04" color="#ca8a04" /> {score}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. CENTER: ONE CONTINUOUS ILLUSTRATED CARTOON SNAKE (EXPANDED 16:9 VIEW)  */}
      {/* ========================================================================= */}
      <div
        style={{
          width: '100%',
          maxWidth: '1600px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          position: 'relative'
        }}
      >
        {!isGameWon ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: '100%',
              maxWidth: '1550px',
              position: 'relative'
            }}
          >
            {/* Active Question Prompt Bubble */}
            <div
              className="animate-pop"
              style={{
                background: 'linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%)',
                color: '#15803d',
                padding: '5px 26px',
                borderRadius: '9999px',
                fontSize: '1.1rem',
                fontWeight: 900,
                border: '3px solid #86efac',
                boxShadow: '0 4px 0 #16a34a',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px'
              }}
            >
              <span>🎯 Current Question on Snake:</span>
              <span style={{ fontSize: '1.3rem', color: '#b45309', fontWeight: 900 }}>
                {activeQuestion?.fullEquation}
              </span>
            </div>

            {/* SINGLE CONTINUOUS ORGANIC CARTOON SNAKE SVG */}
            <div
              style={{
                width: '100%',
                maxHeight: '340px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                filter: 'drop-shadow(0 14px 24px rgba(0,0,0,0.18))',
                padding: '0 16px',
                boxSizing: 'border-box'
              }}
            >
              <svg
                viewBox="0 0 1480 320"
                preserveAspectRatio="xMidYMid meet"
                style={{ width: '100%', height: 'auto', maxHeight: '320px', overflow: 'visible' }}
              >
                <defs>
                  {/* Main vibrant green gradient for smooth snake body */}
                  <linearGradient id="cartoonSnakeBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#22c55e" />
                    <stop offset="30%" stopColor="#4ade80" />
                    <stop offset="70%" stopColor="#22c55e" />
                    <stop offset="100%" stopColor="#16a34a" />
                  </linearGradient>

                  {/* Butter yellow underbelly gradient */}
                  <linearGradient id="cartoonSnakeBellyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#fef08a" />
                    <stop offset="100%" stopColor="#facc15" />
                  </linearGradient>

                  {/* Active target highlight glow */}
                  <radialGradient id="activeZoneGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fef08a" stopOpacity="0.85" />
                    <stop offset="65%" stopColor="#fde047" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
                  </radialGradient>

                  {/* Subtle 3D shadow for snake */}
                  <filter id="snakeSoftShadow" x="-10%" y="-10%" width="120%" height="120%">
                    <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#064e3b" floodOpacity="0.4" />
                  </filter>
                </defs>

                {/* ============================================================= */}
                {/* 1. CONTINUOUS SNAKE BODY & BELLY (ONE SEAMLESS CURVE)         */}
                {/* ============================================================= */}
                <g filter="url(#snakeSoftShadow)">
                  {/* Dark Green Bold Cartoon Outline */}
                  <path
                    d={stageData.bodyOutline}
                    fill="none"
                    stroke="#14532d"
                    strokeWidth="86"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: 'd 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  />

                  {/* Continuous Smooth Green Cartoon Skin */}
                  <path
                    d={stageData.bodySkin}
                    fill="none"
                    stroke="url(#cartoonSnakeBodyGrad)"
                    strokeWidth="74"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: 'd 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  />

                  {/* Continuous Underbelly Ribbon */}
                  <path
                    d={stageData.bellySkin}
                    fill="none"
                    stroke="url(#cartoonSnakeBellyGrad)"
                    strokeWidth="30"
                    strokeLinecap="round"
                    style={{ transition: 'd 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  />

                  {/* Natural Curved Belly Scales */}
                  {stageData.bellyStripes.map((stripeD, i) => (
                    <path
                      key={i}
                      d={stripeD}
                      fill="none"
                      stroke="#b45309"
                      strokeWidth="3"
                      strokeLinecap="round"
                      opacity="0.65"
                    />
                  ))}
                </g>

                {/* ============================================================= */}
                {/* 2. NATURAL TAPERED TAIL TIP (CONNECTED ORGANICALLY)           */}
                {/* ============================================================= */}
                <g
                  transform={`translate(${stageData.tailTip.x}, ${stageData.tailTip.y}) rotate(${stageData.tailTip.rot})`}
                  style={{ transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                >
                  {/* Tapered Point with outline */}
                  <path
                    d="M -5,-18 C 22,-14 48,-4 72,0 C 48,4 22,14 -5,18 Z"
                    fill="#16a34a"
                    stroke="#14532d"
                    strokeWidth="4"
                  />
                  {/* Soft Tail Tip Rattle Ornaments */}
                  <circle cx="46" cy="0" r="9" fill="#fde047" stroke="#b45309" strokeWidth="2.5" />
                  <circle cx="61" cy="0" r="6.5" fill="#facc15" stroke="#b45309" strokeWidth="2" />
                  <circle cx="72" cy="0" r="4" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
                </g>

                {/* ============================================================= */}
                {/* 3. HEAD & NECK - SEAMLESSLY ATTACHED (0 GAP / NO FLOATING)     */}
                {/* ============================================================= */}
                <g transform="translate(160, 138)">
                  {/* Neck Flesh Blend - completely seals head to body spine */}
                  <path
                    d="M -15,10 C 15,15 45,15 65,10 C 65,40 30,55 -5,48 Z"
                    fill="#22c55e"
                    stroke="#14532d"
                    strokeWidth="4"
                  />
                  {/* Cheerful Head Circle */}
                  <ellipse cx="0" cy="0" rx="58" ry="52" fill="#22c55e" stroke="#14532d" strokeWidth="5.5" />

                  {/* Cute Rosy Cheeks */}
                  <ellipse cx="-38" cy="14" rx="12" ry="8" fill="#f472b6" opacity="0.85" />
                  <ellipse cx="38" cy="14" rx="12" ry="8" fill="#f472b6" opacity="0.85" />

                  {/* Playful Forked Tongue */}
                  <path
                    d="M 0,38 Q 0,65 8,72 M 8,72 L 18,78 M 8,72 L 0,80"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />

                  {/* Big Expressive Cartoon Eyes */}
                  {/* Left Eye */}
                  <ellipse cx="-24" cy="-14" rx="18" ry="21" fill="#FFFFFF" stroke="#14532d" strokeWidth="4" />
                  <ellipse cx="-22" cy="-14" rx="9" ry="11" fill="#0f172a" />
                  <circle cx="-18" cy="-19" r="5" fill="#FFFFFF" />
                  <circle cx="-25" cy="-8" r="2.5" fill="#FFFFFF" />

                  {/* Right Eye */}
                  <ellipse cx="24" cy="-14" rx="18" ry="21" fill="#FFFFFF" stroke="#14532d" strokeWidth="4" />
                  <ellipse cx="22" cy="-14" rx="9" ry="11" fill="#0f172a" />
                  <circle cx="26" cy="-19" r="5" fill="#FFFFFF" />
                  <circle cx="19" cy="-8" r="2.5" fill="#FFFFFF" />

                  {/* Cute Happy Smile */}
                  <path
                    d="M -18,22 Q 0,38 18,22"
                    fill="none"
                    stroke="#14532d"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />

                  {/* Mascot Party Hat */}
                  <polygon points="0,-72 -20,-42 20,-42" fill="#f59e0b" stroke="#b45309" strokeWidth="3.5" />
                  <circle cx="0" cy="-72" r="6" fill="#ef4444" />
                  <line x1="-16" y1="-50" x2="16" y2="-50" stroke="#fef08a" strokeWidth="3" />
                </g>

                {/* ============================================================= */}
                {/* 4. MATH QUESTIONS PRINTED DIRECTLY ON SNAKE BODY (NO BOXES)   */}
                {/* ============================================================= */}
                {questionsList.slice(currentIdx).map((q, relativeIdx) => {
                  const absoluteIdx = currentIdx + relativeIdx;
                  const isCurrentTarget = relativeIdx === 0;
                  const isShrinking = shrinkingTailIdx === absoluteIdx;
                  const pos = stageData.questionPositions[relativeIdx];
                  if (!pos) return null;

                  return (
                    <g
                      key={q.id}
                      transform={`translate(${pos.x}, ${pos.y}) rotate(${pos.rot}) scale(${isShrinking ? 0.05 : 1})`}
                      style={{
                        transition:
                          'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.45s ease',
                        opacity: isShrinking ? 0 : 1
                      }}
                    >
                      {/* Soft Glow marking on snake skin for active question */}
                      {isCurrentTarget && (
                        <ellipse
                          cx="0"
                          cy="0"
                          rx="72"
                          ry="40"
                          fill="url(#activeZoneGlow)"
                        />
                      )}

                      {/* Natural Curved Scale Ring Stripes on Snake's Body */}
                      <path
                        d="M -46,-12 Q 0,-24 46,-12"
                        fill="none"
                        stroke={isCurrentTarget ? '#fef08a' : '#bbf7d0'}
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        opacity={isCurrentTarget ? 0.9 : 0.45}
                      />
                      <path
                        d="M -46,14 Q 0,26 46,14"
                        fill="none"
                        stroke={isCurrentTarget ? '#fef08a' : '#bbf7d0'}
                        strokeWidth="3"
                        strokeLinecap="round"
                        opacity={isCurrentTarget ? 0.9 : 0.45}
                      />

                      {/* Question Text printed directly on snake body */}
                      <text
                        x="0"
                        y="9"
                        textAnchor="middle"
                        fill={isCurrentTarget ? '#fef08a' : '#ffffff'}
                        fontSize="32"
                        fontWeight="900"
                        fontFamily="'Fredoka', sans-serif"
                        letterSpacing="1px"
                        stroke="#064e3b"
                        strokeWidth={isCurrentTarget ? '4' : '3.5'}
                        paintOrder="stroke fill"
                      >
                        {q.text}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Hint Trigger & Pedagogical Method Box */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              <button
                onClick={() => {
                  sfx.playPop();
                  setShowHintCard((prev) => !prev);
                  if (!showHintCard && activeQuestion) {
                    setSnakeDialogue(`“Here's how to solve ${activeQuestion.text}: ${activeQuestion.baseHint}” 💡`);
                  }
                }}
                className="btn-3d"
                style={{
                  background: showHintCard ? '#fef08a' : 'rgba(255, 255, 255, 0.95)',
                  color: '#854d0e',
                  border: '2px solid #fde047',
                  borderRadius: '9999px',
                  padding: '5px 20px',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 0 #eab308'
                }}
              >
                <Lightbulb size={16} fill="#ca8a04" color="#ca8a04" />
                {showHintCard ? 'Hide Method Hint' : '💡 Need a Hint?'}
              </button>

              {showHintCard && activeQuestion && (
                <div
                  className="animate-pop"
                  style={{
                    background: 'linear-gradient(180deg, #ffffff 0%, #fefce8 100%)',
                    border: '3px dashed #facc15',
                    borderRadius: '18px',
                    padding: '8px 22px',
                    color: '#713f12',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    textAlign: 'center',
                    maxWidth: '680px',
                    boxShadow: '0 6px 0 #ca8a04',
                    lineHeight: 1.3
                  }}
                >
                  💡 <span style={{ color: '#854d0e', fontWeight: 900 }}>Method:</span> {activeQuestion.baseHint}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* WIN SCREEN CELEBRATION */
          <div
            className="animate-pop"
            style={{
              background: '#FFFFFF',
              borderRadius: '36px',
              padding: '40px 50px',
              border: '6px solid #10b981',
              boxShadow: '0 16px 0 #059669, 0 25px 40px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '18px',
              textAlign: 'center',
              maxWidth: '540px'
            }}
          >
            <div style={{ fontSize: '4.5rem' }}>🎉🐍🏆</div>
            <h2
              style={{
                fontSize: '2.8rem',
                fontWeight: 900,
                color: '#065f46',
                margin: 0
              }}
            >
              Tail Shrunk Completely!
            </h2>
            <p style={{ fontSize: '1.25rem', color: '#334155', margin: 0, lineHeight: 1.4 }}>
              Fantastic job! You solved all the Grade 5 math problems and helped Sammy shrink his long tail to the perfect cute size!
            </p>

            <div
              style={{
                background: '#fef08a',
                color: '#854d0e',
                padding: '10px 30px',
                borderRadius: '9999px',
                fontSize: '1.6rem',
                fontWeight: 900,
                border: '3px solid #fde047',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <Star size={28} fill="#ca8a04" color="#ca8a04" /> Final Score: {score}
            </div>

            <button
              onClick={initializeGame}
              className="btn-3d animate-pulse-glow"
              style={{
                background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)',
                color: '#FFFFFF',
                fontSize: '1.4rem',
                fontWeight: 900,
                padding: '16px 40px',
                borderRadius: '9999px',
                border: '4px solid #FFFFFF',
                boxShadow: '0 8px 0 #047857',
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <RefreshCw size={24} /> Play Again!
            </button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. BOTTOM AREA: SEPARATE 4 ANSWER CHOICES                                 */}
      {/* ========================================================================= */}
      {!isGameWon && activeQuestion ? (
        <div
          className="animate-pop"
          style={{
            width: '100%',
            maxWidth: '920px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            zIndex: 25,
            marginBottom: '4px'
          }}
        >
          <div
            style={{
              fontSize: '1rem',
              fontWeight: 900,
              color: '#0369a1',
              background: '#FFFFFF',
              padding: '3px 20px',
              borderRadius: '9999px',
              border: '2px solid #bae6fd',
              boxShadow: '0 3px 0 #7dd3fc',
              letterSpacing: '1px'
            }}
          >
            CHOOSE THE CORRECT ANSWER BELOW:
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '16px',
              width: '100%'
            }}
          >
            {activeQuestion.options.map((opt, i) => {
              const isSelected = selectedOption === opt;
              const isCorrectAnswer = opt === activeQuestion.answer;

              let btnBg = 'linear-gradient(180deg, #38bdf8 0%, #0284c7 100%)';
              let btnShadow = '#0369a1';

              if (isSelected && isAnswerChecking) {
                if (isCorrectAnswer) {
                  btnBg = 'linear-gradient(180deg, #34d399 0%, #059669 100%)';
                  btnShadow = '#047857';
                } else {
                  btnBg = 'linear-gradient(180deg, #f87171 0%, #dc2626 100%)';
                  btnShadow = '#991b1b';
                }
              }

              return (
                <button
                  key={i}
                  onClick={() => handleSelectOption(opt)}
                  disabled={isAnswerChecking}
                  className="btn-3d"
                  style={{
                    background: btnBg,
                    color: '#FFFFFF',
                    fontSize: 'clamp(2rem, 4vw, 2.8rem)',
                    fontWeight: 900,
                    padding: '16px 20px',
                    borderRadius: '24px',
                    border: '5px solid #FFFFFF',
                    boxShadow: `0 8px 0 ${btnShadow}, 0 12px 20px rgba(0,0,0,0.18)`,
                    cursor: isAnswerChecking ? 'default' : 'pointer',
                    transition: 'all 0.1s ease',
                    textShadow: '0 2px 4px rgba(0,0,0,0.3)'
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* 4. BOTTOM-RIGHT FRIENDLY SNAKE COMPANION WITH DIALOGUE                    */}
      {/* ========================================================================= */}
      <div
        style={{
          position: 'absolute',
          bottom: '12px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          zIndex: 30,
          pointerEvents: 'none'
        }}
      >
        {/* Dynamic Speech Bubble */}
        <div
          className="animate-pop"
          key={snakeDialogue}
          style={{
            background: '#FFFFFF',
            border: '4px solid #10b981',
            borderRadius: '24px',
            borderBottomRightRadius: '4px',
            padding: '10px 20px',
            maxWidth: '300px',
            boxShadow: '0 8px 0 #059669, 0 12px 20px rgba(0,0,0,0.15)',
            marginBottom: '10px',
            position: 'relative'
          }}
        >
          <div
            style={{
              fontSize: '0.85rem',
              fontWeight: 900,
              color: '#059669',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '2px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Sparkles size={14} /> Sammy the Snake
          </div>
          <div
            style={{
              fontSize: '1.1rem',
              fontWeight: 800,
              color: '#1e293b',
              lineHeight: 1.3
            }}
          >
            {snakeDialogue}
          </div>
        </div>

        {/* CUTE FRIENDLY CARTOON SNAKE SVG AVATAR */}
        <div
          style={{
            width: '125px',
            height: '125px',
            filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.25))',
            transformOrigin: 'bottom center',
            animation:
              snakeEmotion === 'cheering'
                ? 'ballWrongWobble 0.6s ease-in-out'
                : 'flowerSway 3.5s ease-in-out infinite'
          }}
        >
          <svg viewBox="0 0 160 160" width="100%" height="100%">
            {/* Coiled Tail */}
            <path
              d="M 30,135 Q 15,120 25,100 T 50,110 T 80,125"
              fill="none"
              stroke="#22c55e"
              strokeWidth="22"
              strokeLinecap="round"
            />
            <path
              d="M 30,135 Q 15,120 25,100 T 50,110 T 80,125"
              fill="none"
              stroke="#86efac"
              strokeWidth="12"
              strokeLinecap="round"
            />

            {/* Snake Coiled Body */}
            <path
              d="M 60,130 C 70,145 110,145 120,125 C 130,105 100,85 85,75"
              fill="none"
              stroke="#16a34a"
              strokeWidth="28"
              strokeLinecap="round"
            />
            {/* Belly Under-stripes */}
            <path
              d="M 60,130 C 70,145 110,145 120,125 C 130,105 100,85 85,75"
              fill="none"
              stroke="#fef08a"
              strokeWidth="14"
              strokeLinecap="round"
            />

            {/* Cute Round Snake Head */}
            <ellipse cx="80" cy="55" rx="38" ry="34" fill="#22c55e" stroke="#15803d" strokeWidth="4" />
            
            {/* Cute Cheeks */}
            <ellipse cx="54" cy="62" rx="7" ry="5" fill="#f472b6" opacity="0.8" />
            <ellipse cx="106" cy="62" rx="7" ry="5" fill="#f472b6" opacity="0.8" />

            {/* Playful Tongue */}
            <path
              d="M 80,75 Q 80,95 86,102 M 86,102 L 94,106 M 86,102 L 80,110"
              fill="none"
              stroke="#ef4444"
              strokeWidth="3.5"
              strokeLinecap="round"
            />

            {/* Big Friendly Cartoon Eyes */}
            <ellipse cx="64" cy="48" rx="11" ry="13" fill="#FFFFFF" stroke="#15803d" strokeWidth="2.5" />
            <ellipse cx="66" cy="48" rx="6" ry="7" fill="#0f172a" />
            <circle cx="68" cy="45" r="3" fill="#FFFFFF" />

            <ellipse cx="96" cy="48" rx="11" ry="13" fill="#FFFFFF" stroke="#15803d" strokeWidth="2.5" />
            <ellipse cx="94" cy="48" rx="6" ry="7" fill="#0f172a" />
            <circle cx="96" cy="45" r="3" fill="#FFFFFF" />

            {/* Smile */}
            <path
              d="M 70,66 Q 80,76 90,66"
              fill="none"
              stroke="#15803d"
              strokeWidth="3.5"
              strokeLinecap="round"
            />

            {/* Explorer Party Hat */}
            <polygon points="80,10 65,30 95,30" fill="#f59e0b" stroke="#b45309" strokeWidth="2.5" />
            <circle cx="80" cy="10" r="4" fill="#ef4444" />
            <line x1="68" y1="24" x2="92" y2="24" stroke="#fef08a" strokeWidth="2" />
          </svg>
        </div>
      </div>
    </div>
  );
};
