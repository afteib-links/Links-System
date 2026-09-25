"""Build-time download only; document processing never accesses the Internet."""
import hashlib
import pathlib
import tarfile
import urllib.request

MODELS = {
    "PP-OCRv5_mobile_det": "50446E5D01AC2A73D5319C89513281F6578414C888C602F9AF13F93FEEFFFC58".lower(),
    "PP-OCRv5_mobile_rec": "566b9512b34e34a9f0db54d87b51fa5a0b9ed2cf1ab7e49728cc0b8b5a64f414",
}
root = pathlib.Path('/models')
root.mkdir(exist_ok=True)
for name, checksum in MODELS.items():
    archive = root / (name + '.tar')
    url = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/' + name + '_infer.tar'
    urllib.request.urlretrieve(url, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != checksum:
        raise RuntimeError('Model checksum mismatch: ' + name)
    destination = root / name
    destination.mkdir(exist_ok=True)
    with tarfile.open(archive) as source:
        source.extractall(destination, filter='data')
    archive.unlink()
    # Official archives have a single containing directory.
    nested = list(destination.iterdir())
    if len(nested) == 1 and nested[0].is_dir():
        for entry in list(nested[0].iterdir()):
            entry.rename(destination / entry.name)
        nested[0].rmdir()
