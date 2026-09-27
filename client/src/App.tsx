import { House, ShoppingCart } from 'lucide-react';
import styles from './App.module.css';
import { WarehousePage } from './WarehousePage';

export function App() {
    return (
        <div className={styles.shell}>
            <header className={styles.header}>Duck Store Platform</header>
            <aside className={styles.sidebar}>
                <nav aria-label="Main navigation">
                    <a href="/" className={`${styles.navItem} ${styles.active}`} aria-current="page">
                        <House size={24} fill="currentColor" strokeWidth={1.5} />
                        Warehouse
                    </a>
                    <button
                        type="button"
                        className={`${styles.navItem} ${styles.unavailable}`}
                        disabled
                        title="Store is available through the API only"
                    >
                        <ShoppingCart size={24} />
                        Store<span className={styles.unavailableLabel}>Unavailable</span>
                    </button>
                </nav>
            </aside>
            <main className={styles.main}>
                <WarehousePage />
            </main>
        </div>
    );
}
