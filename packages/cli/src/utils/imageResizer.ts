// TODO: image downscaling lands with the file-read tool; only the error
// class the API error mapper needs lives here for now.

export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageResizeError'
  }
}
