import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const STAGE_LABELS = {
  processing: 'Processing your order',
  printing: 'Printing your receipt',
  complete: 'Order complete',
};

const FEED_DURATION = 1750;

const FEED_STEPS = [
  '-100%', '-91%', '-91%', '-81%', '-81%', '-70%', '-70%', '-58%', '-58%', '-45%',
  '-45%', '-32%', '-32%', '-20%', '-20%', '-10%', '-10%', '-3%', '-3%', '0%',
];

const FEED_TIMES = [
  0, 0.075, 0.105, 0.18, 0.21, 0.285, 0.315, 0.39, 0.42, 0.495,
  0.525, 0.6, 0.63, 0.705, 0.735, 0.81, 0.84, 0.915, 0.945, 1,
];

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

const PAPER_TOOTH = 4;

const ReceiptPrinterContext = createContext(null);

function cx(...values) {
  return values.filter(Boolean).join(' ');
}

function steppedFeed(progress) {
  const times = FEED_TIMES;
  const steps = FEED_STEPS;
  if (progress <= times[0]) return steps[0];
  if (progress >= times[times.length - 1]) return steps[steps.length - 1];
  let index = 1;
  while (times[index] < progress) index += 1;
  const from = times[index - 1];
  const to = times[index];
  const start = Number.parseFloat(steps[index - 1]);
  const end = Number.parseFloat(steps[index]);
  const ratio = to === from ? 1 : (progress - from) / (to - from);
  return `${(start + (end - start) * ratio).toFixed(2)}%`;
}

function usePrinter(part) {
  const context = useContext(ReceiptPrinterContext);
  if (!context) {
    throw new Error(`ReceiptPrinter.${part} must be used inside ReceiptPrinter.`);
  }
  return context;
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event) => setReduce(event.matches);
    if (query.addEventListener) {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return reduce;
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useIsoLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return mounted;
}

function useSwap(value, animate) {
  const [previous, setPrevious] = useState(null);
  const currentRef = useRef(value);

  useEffect(() => {
    let frame = null;
    let timer = null;
    const updatePrevious = (next) => {
      frame = requestAnimationFrame(() => setPrevious(next));
    };

    if (currentRef.current === value) {
      if (!animate) updatePrevious(null);
      return () => { if (frame !== null) cancelAnimationFrame(frame); };
    }
    const outgoing = currentRef.current;
    currentRef.current = value;
    if (!animate) {
      updatePrevious(null);
      return () => { if (frame !== null) cancelAnimationFrame(frame); };
    }
    updatePrevious(outgoing);
    timer = setTimeout(() => {
      setPrevious((current) => (current === outgoing ? null : current));
    }, 220);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
    };
  }, [value, animate]);

  return previous !== null && previous !== value ? previous : null;
}

function LoaderCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CircleCheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ReceiptPrinter({
  stage,
  animate = true,
  feedMotion = 'stepped',
  'aria-label': ariaLabel = 'Receipt printer',
  className,
  children,
  ...rest
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldMove = animate && !prefersReducedMotion;

  const value = useMemo(
    () => ({ stage, animate, feedMotion, shouldMove }),
    [stage, animate, feedMotion, shouldMove],
  );

  return (
    <ReceiptPrinterContext.Provider value={value}>
      <section aria-label={ariaLabel} data-stage={stage} className={cx('rp', className)} {...rest}>
        {children}
      </section>
    </ReceiptPrinterContext.Provider>
  );
}

export function ReceiptPrinterHeader({ className, children, ...rest }) {
  return (
    <div className={cx('rp-header', className)} {...rest}>
      {children}
    </div>
  );
}

export function ReceiptPrinterMachine({ className, children, ...rest }) {
  return (
    <div className={cx('rp-machine', className)} {...rest}>
      {children}
      <div aria-hidden="true" className="rp-machine__slot" />
    </div>
  );
}

export function ReceiptPrinterScreen({ className, children, ...rest }) {
  return (
    <div className={cx('rp-screen', className)} {...rest}>
      <div className="rp-screen__inner">{children}</div>
    </div>
  );
}

export function ReceiptPrinterStatus({ label, className, ...rest }) {
  const { stage, animate, shouldMove } = usePrinter('Status');
  const mounted = useMounted();
  const outgoing = useSwap(stage, animate);

  const motion = !mounted || !animate ? 'off' : shouldMove ? 'full' : 'fade';
  const text = label ?? STAGE_LABELS[stage] ?? '';
  const isComplete = stage === 'complete';

  const glyph = (stageName, exit) => {
    const complete = stageName === 'complete';
    return (
      <span
        key={exit ? `exit-${stageName}` : stageName}
        data-motion={motion}
        data-exit={exit || undefined}
        className={cx(
          'rp-status__glyph',
          complete ? 'rp-status__glyph--ok' : 'rp-status__glyph--spin',
          !complete && motion === 'full' && 'is-spinning',
        )}
      >
        {complete ? <CircleCheckIcon /> : <LoaderCircleIcon />}
      </span>
    );
  };

  return (
    <div className={cx('rp-status', className)} {...rest}>
      <span aria-hidden="true" className="rp-status__icon">
        {glyph(isComplete ? 'complete' : 'working', false)}
        {outgoing !== null && glyph(outgoing, true)}
      </span>
      <div aria-live="polite" role="status" className="rp-status__labelbox">
        <div key={stage} data-motion={motion} className="rp-status__label">
          {text}
        </div>
        {outgoing !== null && (
          <div key={`exit-${outgoing}`} data-motion={motion} data-exit className="rp-status__label">
            {label ?? STAGE_LABELS[outgoing] ?? ''}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReceiptPrinterOutput({ className, children, ...rest }) {
  const { stage, animate, feedMotion, shouldMove } = usePrinter('Output');
  const sheetRef = useRef(null);
  const frameRef = useRef(null);
  const ready = useMounted();

  useIsoLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;

    const stop = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    const setOffset = (value) => {
      sheet.style.translate = `0 ${value}`;
    };

    if (stage === 'printing' && shouldMove) {
      const smooth = feedMotion === 'smooth';
      setOffset('-100%');
      const startedAt = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - startedAt) / FEED_DURATION);
        setOffset(smooth ? `${(-100 + progress * 100).toFixed(2)}%` : steppedFeed(progress));
        frameRef.current = progress < 1 ? requestAnimationFrame(tick) : null;
      };
      frameRef.current = requestAnimationFrame(tick);
      return stop;
    }

    stop();
    setOffset(stage === 'complete' || !shouldMove ? '0%' : '-100%');
    return undefined;
  }, [stage, feedMotion, shouldMove]);

  const visible = stage !== 'processing';

  return (
    <div className={cx('rp-output', className)} {...rest}>
      {visible && <div aria-hidden="true" className="rp-output__slot-shadow" />}
      <div
        ref={sheetRef}
        className="rp-sheet"
        aria-hidden={!visible}
        style={{
          opacity: visible ? 1 : 0,
          transition: ready ? `opacity ${animate ? 160 : 0}ms ${EASE}` : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ReceiptPrinterPaper({ className, children, style, ...rest }) {
  const clipPath = useMemo(() => {
    const teeth = [];
    for (let index = 0; index < 80; index += 1) {
      const x = 100 - ((index + 1) * 100) / 80;
      const y = index % 2 === 0 ? '100%' : `calc(100% - ${PAPER_TOOTH}px)`;
      teeth.push(`${x}% ${y}`);
    }
    return `polygon(0 0, 100% 0, 100% calc(100% - ${PAPER_TOOTH}px), ${teeth.join(', ')})`;
  }, []);

  return (
    <article
      className={cx('rp-paper', className)}
      style={{ clipPath, ...style }}
      {...rest}
    >
      {children}
    </article>
  );
}

export { ReceiptPrinterContext, STAGE_LABELS as RECEIPT_PRINTER_LABELS };
