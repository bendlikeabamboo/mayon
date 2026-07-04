export interface Box {
	w: number;
	h: number;
}

export function computeCenter(viewport: Box, svg: Box): { x: number; y: number } {
	return {
		x: (viewport.w - svg.w) / 2,
		y: (viewport.h - svg.h) / 2
	};
}
