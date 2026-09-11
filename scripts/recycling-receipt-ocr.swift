import Foundation
import Vision
import ImageIO

struct TextBox: Codable { let text: String; let confidence: Float; let x: Double; let y: Double; let width: Double; let height: Double }
guard CommandLine.arguments.count == 2 else { fatalError("One image path is required") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(url: url, options: [:]).perform([request])
let boxes = (request.results ?? []).compactMap { observation -> TextBox? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return TextBox(text: candidate.string, confidence: candidate.confidence, x: box.minX, y: box.midY, width: box.width, height: box.height)
}
let data = try JSONEncoder().encode(boxes)
print(String(data: data, encoding: .utf8)!)
