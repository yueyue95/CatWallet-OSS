import { WalletCards } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-100 grid place-items-center bg-background/45 text-foreground backdrop-blur-[2px]"
      aria-label="正在加载 CatWallet"
      aria-live="polite"
    >
      <div className="relative grid size-24 place-items-center">
        <div className="catwallet-loading-loader grid size-14 place-items-center rounded-full bg-primary">
          <WalletCards
            className="size-8 text-primary-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
