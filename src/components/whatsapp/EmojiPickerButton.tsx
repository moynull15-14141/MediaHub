import { useEffect, useRef, useState } from 'react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { Smile } from 'lucide-react';
import { Button } from '@/src/components/ui/button';

interface EmojiPickerButtonProps {
  onSelect: (emoji: string) => void;
}

// Professional emoji picker via a lightweight library (no custom
// implementation) - cursor insertion is handled by the caller via onSelect.
export function EmojiPickerButton({ onSelect }: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.dataset.theme !== 'light';

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-label="Insert emoji">
        <Smile className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2">
          <EmojiPicker
            theme={isDark ? Theme.DARK : Theme.LIGHT}
            onEmojiClick={(data: EmojiClickData) => {
              onSelect(data.emoji);
              setOpen(false);
            }}
            lazyLoadEmojis
            searchDisabled={false}
          />
        </div>
      )}
    </div>
  );
}
