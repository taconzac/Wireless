/**
 * Shared inventory-stacking helper used by both the item vacuum and the
 * distribution logic. Fills existing partial stacks first, then empty
 * slots, respecting each item's own max stack size.
 * @returns the amount that could not be inserted (0 if everything fit)
 */
export function addItemsToInventory(inventory, itemStack, count) {
  let remaining = count;

  for (let i = 0; i < inventory.size; i++) {
    if (remaining <= 0) break;
    const slot = inventory.getItem(i);
    if (
      slot &&
      slot.typeId === itemStack.typeId &&
      slot.amount < slot.maxAmount
    ) {
      const space = slot.maxAmount - slot.amount;
      const add = Math.min(space, remaining);
      slot.amount += add;
      inventory.setItem(i, slot);
      remaining -= add;
    }
  }

  if (remaining > 0) {
    for (let i = 0; i < inventory.size; i++) {
      if (remaining <= 0) break;
      if (!inventory.getItem(i)) {
        const newStack = itemStack.clone();
        newStack.amount = remaining;
        inventory.setItem(i, newStack);
        remaining = 0;
      }
    }
  }
  return remaining;
}
