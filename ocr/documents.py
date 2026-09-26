"""Bounded local image/PDF input, retaining original bytes separately."""
import pypdfium2 as pdfium
from PIL import Image, ImageOps


class ImageBitmap:
    def __init__(self, image):
        self.image = image
    def to_pil(self):
        return self.image
    def close(self):
        self.image.close()


class ImagePage:
    def __init__(self, path):
        with Image.open(path) as source:
            if source.width * source.height > 40_000_000:
                raise ValueError('Image exceeds 40 megapixels')
            self.image = ImageOps.exif_transpose(source).convert('RGB')
    def get_size(self):
        return self.image.size
    def render(self, scale):
        image = self.image.copy()
        image.thumbnail((int(image.width * min(1, scale)), int(image.height * min(1, scale))))
        return ImageBitmap(image)
    def close(self):
        self.image.close()


class ImageDocument:
    def __init__(self, path):
        self.path = path
    def __len__(self):
        return 1
    def __getitem__(self, index):
        if index != 0:
            raise IndexError(index)
        return ImagePage(self.path)
    def close(self):
        pass


def open_document(path, mime):
    return pdfium.PdfDocument(str(path)) if mime == 'application/pdf' else ImageDocument(path)
