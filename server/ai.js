export function aiMixAssistant(track, reference){

let recommendation = "STREAM"
let message = "Balanced track – Streaming master recommended"

// Om ingen reference finns
if(!reference){

if(track.energy === "High"){
recommendation = "CLUB"
message = "High energy track – Club master recommended"
}

if(track.energy === "Low"){
recommendation = "STREAM"
message = "Low energy track – Streaming master recommended"
}

return {
recommendation,
message
}

}

// Om reference finns använder AI den
if(reference){

// Loud reference
if(reference.lufs > -9){
recommendation = "LOUD"
message = "Reference track is loud – Loud master recommended"
}

// Club reference
if(reference.energy === "High"){
recommendation = "CLUB"
message = "High energy reference – Club master recommended"
}

// Warm tonal reference
if(reference.spectral && reference.spectral.low > reference.spectral.high){
recommendation = "WARM"
message = "Reference has warm tonal balance – Warm master recommended"
}

}

return {

recommendation,
message

}

}