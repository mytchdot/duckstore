import { type RefObject, useRef, useState } from 'react';
import type { Duck } from '../../shared/contracts';
import { deleteDuck } from './api';
import { Button } from './Button';
import { Dialog, DialogActions } from './Dialog';

interface DeleteDuckDialogProps {
    duck: Duck;
    onClose: () => void;
    onDeleted: () => Promise<void>;
    fallbackFocusRef: RefObject<HTMLElement | null>;
}

export function DeleteDuckDialog({ duck, onClose, onDeleted, fallbackFocusRef }: DeleteDuckDialogProps) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const deletePending = useRef(false);

    async function confirmDelete() {
        if (deletePending.current) return;
        deletePending.current = true;
        setBusy(true);
        setError('');
        try {
            await deleteDuck(duck.id);
            await onDeleted();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Unable to delete duck.');
        } finally {
            deletePending.current = false;
            setBusy(false);
        }
    }

    return (
        <Dialog
            title="Delete Duck"
            description={`Delete duck #${duck.id} (${duck.color}, ${duck.size}) from inventory?`}
            busy={busy}
            onClose={onClose}
            fallbackFocusRef={fallbackFocusRef}
        >
            {error && (
                <div className="alert alert-error" role="alert">
                    {error}
                </div>
            )}
            <DialogActions>
                <Button data-autofocus disabled={busy} onClick={onClose}>
                    Cancel
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void confirmDelete()}>
                    {busy ? 'Deleting…' : 'Delete Duck'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
