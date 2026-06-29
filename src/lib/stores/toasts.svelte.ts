export interface ToastAction {
	label: string;
	href: string;
}

export interface Toast {
	id: string;
	title: string;
	description?: string;
	action?: ToastAction;
}

class ToastState {
	toasts = $state<Toast[]>([]);

	private autoDismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

	push(t: Omit<Toast, 'id'>): string {
		const id = crypto.randomUUID();
		const toast: Toast = { id, ...t };
		this.toasts = [...this.toasts, toast];

		this.autoDismissTimers.set(
			id,
			setTimeout(() => {
				this.dismiss(id);
			}, 5000)
		);

		return id;
	}

	dismiss(id: string): void {
		const timer = this.autoDismissTimers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.autoDismissTimers.delete(id);
		}
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	clear(): void {
		for (const timer of this.autoDismissTimers.values()) {
			clearTimeout(timer);
		}
		this.autoDismissTimers.clear();
		this.toasts = [];
	}
}

export const toastState = new ToastState();
