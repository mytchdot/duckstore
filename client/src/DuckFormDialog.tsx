import { type FormEvent, type RefObject, useRef, useState } from 'react';
import { COLORS, type Color, type Duck, MAX_QUANTITY, SIZES, type Size } from '../../shared/contracts';
import { ApiError, addDuck } from './api';
import { Button } from './Button';
import { Dialog, DialogActions } from './Dialog';
import styles from './DuckFormDialog.module.css';
import { saveDuckChanges } from './duckEdits';

interface DuckFormDialogProps {
    duck?: Duck;
    onClose: () => void;
    onSaved: (message: string) => void;
    fallbackFocusRef: RefObject<HTMLElement | null>;
}

export function DuckFormDialog({ duck, onClose, onSaved, fallbackFocusRef }: DuckFormDialogProps) {
    const [color, setColor] = useState<Color>(duck?.color ?? 'Red');
    const [size, setSize] = useState<Size>(duck?.size ?? 'Medium');
    const [price, setPrice] = useState(duck?.price ?? '');
    const [quantity, setQuantity] = useState(duck ? String(duck.quantity) : '');
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
    const edit = Boolean(duck);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError('');
        setFieldErrors({});
        try {
            const input = { price, quantity: Number(quantity) };
            if (duck) {
                if (await saveDuckChanges(duck, price, input.quantity)) onSaved('Duck updated successfully.');
                else onClose();
            } else {
                const { duck: saved, created } = await addDuck({ color, size, ...input });
                onSaved(
                    created
                        ? 'Duck added to inventory.'
                        : `Duck #${saved.id} already existed, so its quantity was increased to ${saved.quantity.toLocaleString('en-US')}.`
                );
            }
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Unable to save duck.');
            if (failure instanceof ApiError) setFieldErrors(failure.fieldErrors ?? {});
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }

    return (
        <Dialog
            title={edit ? 'Edit Duck' : 'Add Duck'}
            description={edit ? 'Update the price and quantity of this duck.' : 'Add a rubber duck to your warehouse.'}
            onClose={onClose}
            busy={busy}
            fallbackFocusRef={fallbackFocusRef}
        >
            <form onSubmit={submit}>
                {error && (
                    <div className="alert alert-error" role="alert">
                        {error}
                        {fieldErrors._form?.map((text) => (
                            <div key={text}>{text}</div>
                        ))}
                    </div>
                )}
                <fieldset disabled={busy} className={styles.fields}>
                    <div className={styles.grid}>
                        <div className={styles.field}>
                            <label htmlFor="duck-color">Color</label>
                            {edit ? (
                                <input id="duck-color" value={color} readOnly />
                            ) : (
                                <select id="duck-color" data-autofocus value={color} onChange={(e) => setColor(e.target.value as Color)}>
                                    {COLORS.map((value) => (
                                        <option key={value}>{value}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="duck-size">Size</label>
                            {edit ? (
                                <input id="duck-size" value={size} readOnly />
                            ) : (
                                <select id="duck-size" value={size} onChange={(e) => setSize(e.target.value as Size)}>
                                    {SIZES.map((value) => (
                                        <option key={value}>{value}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="duck-price">Price (USD)</label>
                            <input
                                id="duck-price"
                                data-autofocus={edit || undefined}
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                max="99999999.99"
                                step="0.01"
                                required
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                aria-invalid={Boolean(fieldErrors.price)}
                                aria-describedby={fieldErrors.price ? 'price-error' : undefined}
                            />
                            {fieldErrors.price && (
                                <span id="price-error" className={styles.error}>
                                    {fieldErrors.price.join(' ')}
                                </span>
                            )}
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="duck-quantity">Quantity</label>
                            <input
                                id="duck-quantity"
                                type="number"
                                inputMode="numeric"
                                min={edit ? 0 : 1}
                                max={MAX_QUANTITY}
                                step="1"
                                required
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                aria-invalid={Boolean(fieldErrors.quantity)}
                                aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined}
                            />
                            {fieldErrors.quantity && (
                                <span id="quantity-error" className={styles.error}>
                                    {fieldErrors.quantity.join(' ')}
                                </span>
                            )}
                        </div>
                    </div>
                </fieldset>
                <DialogActions>
                    <Button disabled={busy} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={busy}>
                        {busy ? 'Saving…' : edit ? 'Save Changes' : 'Add Duck'}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
