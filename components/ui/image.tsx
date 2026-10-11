import * as React from "react"
import { cn } from "@/lib/utils"

export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallback?: string
}

const Image = React.forwardRef<HTMLImageElement, ImageProps>(
  ({ className, fallback, alt = "", onError, ...props }, ref) => {
    const [hasError, setHasError] = React.useState(false)
    const [loaded, setLoaded] = React.useState(false)

    return (
      <img
        ref={ref}
        alt={alt}
        loading="lazy"
        onLoad={(e) => {
          setLoaded(true)
          props.onLoad?.(e)
        }}
        onError={(e) => {
          setHasError(true)
          onError?.(e)
        }}
        className={cn(
          "transition-opacity duration-300",
          !loaded && "opacity-0",
          loaded && "opacity-100",
          className
        )}
        {...(hasError && fallback ? { src: fallback } : props)}
        {...props}
      />
    )
  }
)
Image.displayName = "Image"

export default Image
export { Image }
