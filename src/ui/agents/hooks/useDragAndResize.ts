/**
 * useDragAndResize — handles window dragging, resizing, and expansion for floating chat.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface WindowBounds {
    width: number;
    height: number;
    x: number;
    y: number;
}

export interface DragResizeReturn {
    containerRef: React.RefObject<HTMLDivElement | null>;
    isDragging: boolean;
    isResizing: boolean;
    isExpanded: boolean;
    setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
    handleMouseDown: (e: React.MouseEvent) => void;
    handleResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
    getContainerStyle: () => React.CSSProperties;
}

const DEFAULT_BOUNDS: WindowBounds = {
    width: 520,
    height: 680,
    x: 0,
    y: 0,
};

const EXPANDED_BOUNDS: WindowBounds = {
    width: 900,
    height: 800,
    x: 0,
    y: 0,
};

const MIN_WIDTH = 380;
const MIN_HEIGHT = 400;

export function useDragAndResize(isMinimized: boolean): DragResizeReturn {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [bounds, setBounds] = useState<WindowBounds>(DEFAULT_BOUNDS);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [resizeDir, setResizeDir] = useState<ResizeDirection | null>(null);
    const resizeStartRef = useRef<{ x: number; y: number; bounds: WindowBounds }>({ x: 0, y: 0, bounds: DEFAULT_BOUNDS });

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (isMinimized) return;
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setDragOffset({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
        setIsDragging(true);
    }, [isMinimized]);

    const handleResizeStart = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
        e.preventDefault();
        e.stopPropagation();
        setResizeDir(direction);
        setIsResizing(true);
        resizeStartRef.current = { x: e.clientX, y: e.clientY, bounds: { ...bounds } };
    }, [bounds]);

    // Global mouse handlers for drag and resize
    useEffect(() => {
        if (!isDragging && !isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const x = e.clientX - dragOffset.x;
                const y = e.clientY - dragOffset.y;
                setBounds(prev => ({ ...prev, x, y }));
            }
            if (isResizing && resizeDir) {
                const dx = e.clientX - resizeStartRef.current.x;
                const dy = e.clientY - resizeStartRef.current.y;
                const start = resizeStartRef.current.bounds;

                setBounds(prev => {
                    const next = { ...prev };
                    if (resizeDir.includes('e')) next.width = Math.max(MIN_WIDTH, start.width + dx);
                    if (resizeDir.includes('w')) next.width = Math.max(MIN_WIDTH, start.width - dx);
                    if (resizeDir.includes('s')) next.height = Math.max(MIN_HEIGHT, start.height + dy);
                    if (resizeDir.includes('n')) next.height = Math.max(MIN_HEIGHT, start.height - dy);
                    return next;
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
            setResizeDir(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, dragOffset, resizeDir]);

    // Toggle expanded
    useEffect(() => {
        if (isExpanded) {
            setBounds(EXPANDED_BOUNDS);
        } else {
            setBounds(DEFAULT_BOUNDS);
        }
    }, [isExpanded]);

    const getContainerStyle = useCallback((): React.CSSProperties => {
        if (isMinimized) {
            return { width: '360px', height: 'auto' };
        }
        return {
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            ...(bounds.x || bounds.y ? {
                left: `${bounds.x}px`,
                top: `${bounds.y}px`,
                right: 'auto',
                bottom: 'auto',
            } : {}),
        };
    }, [bounds, isMinimized]);

    return {
        containerRef,
        isDragging,
        isResizing,
        isExpanded,
        setIsExpanded,
        handleMouseDown,
        handleResizeStart,
        getContainerStyle,
    };
}
