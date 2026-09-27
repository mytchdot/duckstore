import { ArrowDown, PackageOpen, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Duck } from '../../shared/contracts';
import { Button } from './Button';
import { DeleteDuckDialog } from './DeleteDuckDialog';
import { DuckFormDialog } from './DuckFormDialog';
import { useInventory } from './useInventory';
import styles from './WarehousePage.module.css';

const usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});
const integer = new Intl.NumberFormat('en-US');

type WarehouseDialog = { kind: 'add' } | { kind: 'edit'; duck: Duck } | { kind: 'delete'; duck: Duck } | null;

export function WarehousePage() {
    const { ducks, loading, error, refresh } = useInventory();
    const [notice, setNotice] = useState('');
    const [dialog, setDialog] = useState<WarehouseDialog>(null);
    const addButton = useRef<HTMLButtonElement>(null);

    function openDialog(next: Exclude<WarehouseDialog, null>) {
        setNotice('');
        setDialog(next);
    }

    function saved(message: string) {
        setDialog(null);
        setNotice(message);
        void refresh();
    }

    async function handleDeleted() {
        // Reload before closing so focus falls back to Add Duck after the deleted row disappears.
        await refresh();
        setDialog(null);
        setNotice('Duck deleted from inventory.');
    }

    return (
        <>
            <div className={styles.heading}>
                <div>
                    <h1>Duck Warehouse</h1>
                    <p>Manage your rubber duck inventory.</p>
                </div>
                <Button
                    ref={addButton}
                    id="add-duck"
                    variant="primary"
                    className={styles.addButton}
                    onClick={() => openDialog({ kind: 'add' })}
                >
                    <Plus size={22} />
                    Add Duck
                </Button>
            </div>
            {notice && (
                <div className="alert alert-success" role="status">
                    {notice}
                </div>
            )}
            {error && (
                <div className="alert alert-error" role="alert">
                    <span>{error}</span>
                    <Button variant="text" onClick={() => void refresh()}>
                        Try again
                    </Button>
                </div>
            )}
            <section className={styles.card} aria-labelledby="inventory-heading" aria-busy={loading}>
                <div className={styles.cardHeading}>
                    <h2 id="inventory-heading">Duck Inventory</h2>
                    <Button
                        variant="icon"
                        className={styles.refresh}
                        aria-label="Refresh inventory"
                        disabled={loading}
                        onClick={() => void refresh()}
                    >
                        <RefreshCw size={17} />
                    </Button>
                </div>
                <div className={styles.tableScroll}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">ID</th>
                                <th scope="col">Color</th>
                                <th scope="col">Size</th>
                                <th scope="col" className={styles.numeric}>
                                    Price (USD)
                                </th>
                                <th scope="col" className={styles.numeric} aria-sort="descending">
                                    Quantity <ArrowDown size={14} />
                                </th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ducks.map((duck) => (
                                <tr key={duck.id}>
                                    <td>{duck.id}</td>
                                    <td>{duck.color}</td>
                                    <td>{duck.size}</td>
                                    <td className={styles.numeric}>{usd.format(Number(duck.price))}</td>
                                    <td className={styles.numeric}>{integer.format(duck.quantity)}</td>
                                    <td>
                                        <div className={styles.actions}>
                                            <Button
                                                variant="text"
                                                className={styles.editAction}
                                                aria-label={`Edit duck ${duck.id}`}
                                                onClick={() => openDialog({ kind: 'edit', duck })}
                                            >
                                                <Pencil size={18} />
                                                Edit
                                            </Button>
                                            <Button
                                                variant="text"
                                                className={styles.deleteAction}
                                                aria-label={`Delete duck ${duck.id}`}
                                                onClick={() => openDialog({ kind: 'delete', duck })}
                                            >
                                                <Trash2 size={18} />
                                                Delete
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {loading && (
                    <p className={styles.status} role="status">
                        Loading inventory…
                    </p>
                )}
                {!loading && !error && !ducks.length && (
                    <div className={styles.empty}>
                        <PackageOpen size={36} />
                        <h3>Your warehouse is empty</h3>
                        <p>Add your first duck to get started.</p>
                    </div>
                )}
            </section>
            {dialog && dialog.kind !== 'delete' && (
                <DuckFormDialog
                    duck={dialog.kind === 'edit' ? dialog.duck : undefined}
                    onClose={() => setDialog(null)}
                    onSaved={saved}
                    fallbackFocusRef={addButton}
                />
            )}
            {dialog?.kind === 'delete' && (
                <DeleteDuckDialog
                    duck={dialog.duck}
                    onClose={() => setDialog(null)}
                    onDeleted={handleDeleted}
                    fallbackFocusRef={addButton}
                />
            )}
        </>
    );
}
