import { useState, useEffect, useCallback } from 'react';

export function useDragDrop(onDropFiles: (files: FileList | File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files) {
        onDropFiles(e.dataTransfer.files);
      }
    },
    [onDropFiles],
  );

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
    };

    window.addEventListener('drop', handleDragDrop);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);

    return () => {
      window.removeEventListener('drop', handleDragDrop);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
    };
  }, [handleDragDrop]);

  return { isDragging };
}
