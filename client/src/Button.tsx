import type { ComponentProps } from 'react';
import styles from './Button.module.css';

type ButtonProps = ComponentProps<'button'> & {
    variant?: 'primary' | 'secondary' | 'danger' | 'text' | 'icon';
};

export function Button({ variant = 'secondary', type = 'button', className = '', ...props }: ButtonProps) {
    return <button {...props} type={type} className={`${styles[variant]} ${className}`} />;
}
