/** Money is integer cents everywhere; this is the only place it becomes a string. */
export const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
