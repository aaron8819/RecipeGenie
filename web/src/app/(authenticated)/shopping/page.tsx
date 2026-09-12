import { ShoppingListView } from "@/components/shopping"
import { ShoppingPendingCommand } from '@/components/shopping/shopping-pending-command'

export default function ShoppingPage() {
  return (
    <div data-app-screen="shopping">
      <ShoppingPendingCommand />
      <ShoppingListView />
    </div>
  )
}
