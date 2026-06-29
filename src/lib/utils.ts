import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChildrenOrChild<T> = Omit<T, 'children' | 'child'>;
export type WithElementRef<T, U = Element> = T & { ref?: U | null };
