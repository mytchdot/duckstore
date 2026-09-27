import { X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import styles from './Dialog.module.css';

export function Dialog({
    title,
    children,
    onClose,
    busy = false,
    description,
    fallbackFocusRef,
}: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    busy?: boolean;
    description?: ReactNode;
    fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        const previous = document.activeElement as HTMLElement | null;
        element.showModal();
        element.querySelector<HTMLElement>('[data-autofocus]')?.focus();
        return () => {
            element.close();
            if (previous?.isConnected) previous.focus();
            else fallbackFocusRef?.current?.focus();
        };
    }, [fallbackFocusRef]);

    return (
        <dialog
            ref={dialog}
            className={styles.dialog}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter(
                    (element) => !element.matches(':disabled')
                );
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }}
            onCancel={(event) => {
                event.preventDefault();
                if (!busy) onClose();
            }}
            onClose={(event) => {
                // Chrome closes a modal itself on a repeated Esc, ignoring preventDefault. Keep it open while a request runs.
                // The open check skips the close event queued by React StrictMode's development remount.
                if (event.currentTarget.open) return;
                if (busy) event.currentTarget.showModal();
                else onClose();
            }}
        >
            <div className={styles.heading}>
                <h2 id={titleId}>{title}</h2>
                <Button variant="icon" aria-label="Close dialog" disabled={busy} onClick={onClose}>
                    <X size={21} />
                </Button>
            </div>
            {description && (
                <p id={descriptionId} className={styles.description}>
                    {description}
                </p>
            )}
            {children}
        </dialog>
    );
}

export const DialogActions = ({ children }: { children: ReactNode }) => {
    return <div className={styles.actions}>{children}</div>;
};
