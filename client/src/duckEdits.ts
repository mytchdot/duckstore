import type { Duck, EditDuckInput } from '../../shared/contracts';
import { editDuck } from './api';

export async function saveDuckChanges(original: Duck, price: string, quantity: number): Promise<boolean> {
    const changes: EditDuckInput = {};
    // Compare values without changing the string representation sent to the API.
    if (Number(price) !== Number(original.price)) changes.price = price;
    if (quantity !== original.quantity) changes.quantity = quantity;
    if (!Object.keys(changes).length) return false;

    // Omitted fields are preserved from the current database row, not the stale form snapshot.
    await editDuck(original.id, changes);
    return true;
}
