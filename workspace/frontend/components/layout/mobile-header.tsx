'use client';

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu, Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SidebarContent } from './sidebar-content';

export function MobileHeader() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Close sheet when clicking a session
  useEffect(() => {
    if (isSheetOpen) {
      const handler = () => setIsSheetOpen(false);
      // Give the session click time to propagate
      const timeout = setTimeout(() => {
        document.addEventListener('session-selected', handler, { once: true });
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [isSheetOpen]);

  return (
    <header className="fixed top-0 start-0 end-0 z-50 flex items-center shrink-0 bg-background/95 backdrop-blur-sm h-[var(--header-height-mobile)]">
      <div className="container-fluid grow flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center p-[8px] gap-2 rounded-[60px] bg-gradient-to-r from-primary to-purple-600 dark:from-purple-950 dark:to-purple-800 shadow-lg">
            <Bot className="size-4 text-white" />
          </div>

          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" mode="icon" size="sm">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent className="p-0 gap-0 w-[255px]" side="left" close={false}>
              <SheetHeader className="p-0 space-y-0" />
              <SheetBody className="flex grow p-0">
                <SidebarContent />
              </SheetBody>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
