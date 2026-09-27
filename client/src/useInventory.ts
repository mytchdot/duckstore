import { useCallback, useEffect, useRef, useState } from 'react';
import type { Duck } from '../../shared/contracts';
import { listDucks } from './api';

export function useInventory() {
    const [ducks, setDucks] = useState<Duck[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const requestSequence = useRef(0);

    const refresh = useCallback(async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setError('');
        try {
            const rows = await listDucks();
            if (sequence === requestSequence.current) setDucks(rows);
        } catch (failure) {
            if (sequence === requestSequence.current) setError(failure instanceof Error ? failure.message : 'Unable to load inventory.');
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        return () => {
            requestSequence.current++;
        };
    }, [refresh]);

    return { ducks, loading, error, refresh };
}
