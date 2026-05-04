import {
ScrollView,
View,
Text,
TouchableOpacity,
StyleSheet,
Alert,
ActivityIndicator,
Image,
Animated
} from "react-native"

import { SafeAreaView } from "react-native-safe-area-context"

import { useState, useRef, useEffect } from "react"

import * as DocumentPicker from "expo-document-picker"
import { Audio } from "expo-av"
import * as Linking from "expo-linking"
import { Ionicons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";

const SERVER = "http://192.168.0.106:3002"

export default function HomeScreen(){

const [file,setFile] = useState(null)
const [referenceTrack,setReferenceTrack] = useState(null)

const [fileName,setFileName] = useState("")
const [referenceName,setReferenceName] = useState("")

const [analysis,setAnalysis] = useState(null)
const [ai,setAi] = useState(null)
const [masterUrl,setMasterUrl] = useState("")

const [mixScore,setMixScore] = useState(null)
const [mixTips,setMixTips] = useState([])
const [loudness,setLoudness] = useState(null)

const [style,setStyle] = useState("STREAM")
const [recommendation,setRecommendation] = useState("")

const [targetLufs,setTargetLufs] = useState(-14)

const [status,setStatus] = useState("")
const [loading,setLoading] = useState(false)

const flashAnim = useRef(new Animated.Value(1)).current

const [masterStats,setMasterStats] = useState(null)

const currentSound = useRef(null)

useEffect(() => {

Audio.setAudioModeAsync({
playsInSilentModeIOS:true,
staysActiveInBackground:false,
shouldDuckAndroid:true
})

},[])

async function pickTrack(){

const result = await DocumentPicker.getDocumentAsync({
type:"audio/*"
})

if(result.canceled) return

const asset = result.assets[0]

setFile(asset)

setReferenceTrack(null)
setReferenceName("")

setAnalysis(null)
setAi(null)
setMasterUrl("")
setStatus("")
setRecommendation("")
setMixScore(null)
setMixTips([])
setLoudness(null)
setMasterStats(null)
}

async function pickReference(){

const result = await DocumentPicker.getDocumentAsync({
type:"audio/*"
})

if(result.canceled) return

const asset = result.assets[0]

setReferenceTrack(asset)
setReferenceName(asset.name)
}

async function analyze(){

setAnalysis(null)
setRecommendation("")
setMixScore(null)
setMixTips([])
setLoudness(null)

if(!file){
Alert.alert("Select track first")
return
}

try{

setLoading(true)
setStatus("Analyzing track...")

const form = new FormData()

form.append("track",{
uri:file.uri,
name:file.name || "track.wav",
type:"audio/wav"
})

if(referenceTrack){

form.append("reference",{
uri:referenceTrack.uri,
name:referenceTrack.name || "reference.wav",
type:"audio/wav"
})

}

const res = await fetch(`${SERVER}/upload`,{
method:"POST",
body:form
})

const data = await res.json()

console.log("ANALYSIS RESPONSE:", data)

setAnalysis(data.analysis)

setMixScore(data.mixScore || null)
setMixTips(data.mixTips || [])
setLoudness(data.loudness || null)

setAi(data.ai || {})

setRecommendation(data.ai?.recommendation || "STREAM")
setStyle(data.ai?.recommendation || "STREAM")

setFileName(data.file || "")

setStatus("Analysis complete")

}catch(err){

console.log(err)
Alert.alert("Analysis failed")

}

setLoading(false)
}

async function master(){

if(!fileName){
Alert.alert("Analyze track first")
return
}

try{

setLoading(true)
setStatus("AI mastering your track...")

const res = await fetch(`${SERVER}/master`,{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
file:fileName,
style:style,
reference:referenceName,
targetLufs:targetLufs
})

})

const data = await res.json()

console.log("MASTER RESPONSE:", data)

const url = `${SERVER}/masters/${data.master}`

console.log("MASTER URL:", url)

setMasterUrl(url)

setStatus("Master complete")

setMasterStats({
lufsBefore: analysis.lufs,
lufsAfter: targetLufs,
widthBefore: analysis.stereoWidth,
widthAfter: analysis.stereoWidth + 0.15,
dynBefore: analysis.dynamicRange,
dynAfter: analysis.dynamicRange - 2
})

}catch(err){

console.log(err)
Alert.alert("Mastering failed")

}

setLoading(false)
}

async function play(uri){

try{

console.log("PLAYING:",uri)

if(currentSound.current){

try{
await currentSound.current.stopAsync()
await currentSound.current.unloadAsync()
}catch(e){}

currentSound.current = null

}

const { sound } = await Audio.Sound.createAsync(
{ uri },
{ shouldPlay:true }
)

currentSound.current = sound

}catch(err){

console.log("Audio error:",err)
Alert.alert("Playback failed")

}

}

async function downloadMaster(){

if(!masterUrl){
Alert.alert("No master available")
return
}

try{

await Linking.openURL(masterUrl)

}catch(err){

console.log(err)
Alert.alert("Download failed")

}

}

function Waveform(){

const bars = Array.from({length:40},(_,i)=>20 + Math.sin(i*0.6)*20 + Math.random()*5)

const anim = useRef(new Animated.Value(1)).current

useEffect(()=>{

Animated.loop(
Animated.sequence([
Animated.timing(anim,{
toValue:1.4,
duration:300,
useNativeDriver:true
}),
Animated.timing(anim,{
toValue:1,
duration:300,
useNativeDriver:true
})
])
).start()

},[])

return(

<View style={{marginTop:15,alignItems:"center"}}>

<Svg width={320} height={60}>

{bars.map((h,i)=>(

<Rect
key={i}
x={i*8}
y={30-h/2}
width={4}
height={h*anim.__getValue()}
rx={2}
fill="#38bdf8"
/>

))}

</Svg>

</View>

)

}

return(

<SafeAreaView style={{flex:1,backgroundColor:"#000C2E"}}>

{loading && (
<View style={styles.loadingOverlay}>
<ActivityIndicator size="large" color="#38bdf8"/>
<Text style={styles.loadingText}>{status}</Text>
</View>
)}

<ScrollView
  style={styles.container}
  contentContainerStyle={{ paddingBottom: 180 }}
  showsVerticalScrollIndicator={false}
>

<View style={styles.header}>

<Image
source={require("../../assets/images/logo.png")}
style={{
  width:200,
  height:200,
  resizeMode:"contain",
  marginBottom:5,
  backgroundColor:"#020617"
}}
/>

<Text style={[styles.subtitle,{marginTop:-15}]}>
AI MASTERING
</Text>
<Text style={styles.tagline}>Professional sound instantly</Text>

</View>

<View style={styles.card}>

<View style={{
flexDirection:"row",
alignItems:"center",
justifyContent:"center",
gap:5,
marginBottom:12
}}>
<Ionicons
  name="flash"
  size={22}
  color="#38bdf8"
  style={{opacity:0.9}}
/>
<Text style={styles.cardTitle}>AI Master Your Track</Text>
</View>

<TouchableOpacity style={styles.button} onPress={pickTrack}>
<Text style={styles.buttonText}>
{file ? "TRACK SELECTED" : "UPLOAD TRACK"}
</Text>
</TouchableOpacity>

{file && (
<Text style={styles.fileName}>
{file.name?.replace(/\.[^/.]+$/, "").slice(0,28)}
</Text>
)}

<TouchableOpacity style={styles.reference} onPress={pickReference}>
<Text style={styles.buttonText}>
{referenceTrack ? "REFERENCE SELECTED" : "UPLOAD REFERENCE TRACK"}
</Text>
</TouchableOpacity>

{referenceTrack && (
<Text style={styles.fileName}>
{referenceTrack.name.replace(/\.[^/.]+$/, "")}
</Text>
)}

{file && (
<TouchableOpacity style={styles.analyze} onPress={analyze}>
<Text style={styles.buttonText}>
{analysis ? "RE-ANALYZE TRACK" : "ANALYZE TRACK"}
</Text>
</TouchableOpacity>
)}

</View>

{analysis && (

<View style={styles.card}>

<Text style={styles.panelTitle}>ANALYSIS</Text>

<Text style={styles.tip}>
Energy: {analysis.energy}{"\n"}
BPM: {analysis.bpm || "—"}{"\n"}
LUFS: {analysis.lufs ? `-${analysis.lufs.toFixed(1)}` : "—"}{"\n"}
Dynamic Range: {analysis.dynamicRange ? analysis.dynamicRange.toFixed(1) : "—"} dB{"\n"}
Stereo Width: {analysis.stereoWidth ? analysis.stereoWidth.toFixed(2) : "—"}
</Text>

{mixScore !== null && (
<>
<Text style={styles.mixScore}>
Mix Score: {mixScore} / 100
</Text>

<View style={styles.scoreBarBackground}>
<View
style={[
styles.scoreBarFill,
{width:`${mixScore}%`}
]}
/>
</View>
</>
)}

<Text style={styles.recommend}>
AI Recommended Master: {recommendation}
</Text>

</View>

)}

{masterStats && (

<View style={[styles.card, styles.masterHighlight]}>

<Text style={styles.panelTitle}>MASTER IMPROVEMENT</Text>

<Text style={styles.tip}>

Loudness: -{masterStats.lufsBefore.toFixed(1)} → {masterStats.lufsAfter} LUFS{"\n"}

Stereo Width: {masterStats.widthBefore.toFixed(2)} → {masterStats.widthAfter.toFixed(2)}
<Text style={{color:"#22c55e"}}>
 {" "} (+{(masterStats.widthAfter - masterStats.widthBefore).toFixed(2)})
</Text>
{"\n"}

Dynamics: {masterStats.dynBefore.toFixed(1)} → {masterStats.dynAfter.toFixed(1)}
<Text style={{color:"#ef4444"}}>
 {" "} ({(masterStats.dynAfter - masterStats.dynBefore).toFixed(1)})
</Text> dB

</Text>

</View>

)}

{mixTips.length > 0 && (

<View style={styles.card}>

<Text style={styles.panelTitle}>AI MIX FEEDBACK</Text>

{mixTips.map((tip,i)=>(
<Text key={i} style={styles.tip}>• {tip}</Text>
))}

</View>

)}

{loudness && (

<View style={styles.card}>

<Text style={styles.panelTitle}>LOUDNESS ANALYSIS</Text>

<Text style={styles.tip}>
Track: {file?.name?.replace(/\.[^/.]+$/, "")}{"\n\n"}
Original Loudness: -{Number(loudness.original).toFixed(1)} LUFS{"\n"}
Suggested Master: {loudness.target} LUFS
</Text>

</View>

)}

<View style={styles.card}>

<Text style={styles.panelTitle}>TARGET LOUDNESS</Text>

<View style={styles.styles}>

{[-14,-10,-8].map(lufs=>(

<TouchableOpacity
key={lufs}
style={[
styles.styleBtn,
targetLufs===lufs && styles.active
]}
onPress={()=>setTargetLufs(lufs)}
>

<View style={{alignItems:"center"}}>
  <Text style={styles.buttonText}>
    {lufs === -14 ? "STREAMING" : lufs === -10 ? "CLUB" : "FESTIVAL"}
  </Text>
  <Text style={styles.lufsSub}>{lufs} LUFS</Text>
</View>

</TouchableOpacity>

))}

</View>

</View>

<View style={styles.card}>

<Text style={styles.panelTitle}>MASTERING</Text>

<View style={styles.styles}>

{["STREAM","CLUB","WARM","LOUD"].map(s=>(

<TouchableOpacity
key={s}
style={[
styles.styleBtn,
style===s && styles.active
]}
onPress={()=>setStyle(s)}
>

<Text style={styles.buttonText}>{s}</Text>

</TouchableOpacity>

))}

</View>

{analysis && (
<TouchableOpacity style={styles.master} onPress={master}>
<Text style={styles.buttonText}>MASTER TRACK</Text>
</TouchableOpacity>
)}

</View>

{masterUrl && (

<View style={styles.compareBox}>

<Text style={styles.compareTitle}>AI MASTER COMPARISON 🎧</Text>

<Waveform/>

<View style={styles.compareRow}>

<TouchableOpacity style={styles.preview} onPress={()=>play(file.uri)}>
<Text style={styles.buttonText}>PLAY ORIGINAL</Text>
</TouchableOpacity>

<TouchableOpacity style={styles.preview} onPress={()=>play(masterUrl)}>
<Text style={styles.buttonText}>PLAY MASTER</Text>
</TouchableOpacity>

</View>

</View>

)}

{status!=="" && (
<Text style={styles.status}>{status}</Text>
)}

{masterUrl!=="" && (
<TouchableOpacity style={styles.download} onPress={downloadMaster}>
<Text style={styles.buttonText}>DOWNLOAD MASTER</Text>
</TouchableOpacity>
)}

</ScrollView>

</SafeAreaView>

)

}

const styles = StyleSheet.create({

container:{flex:1,backgroundColor:"#020617",padding:20},

header:{alignItems:"center",marginBottom:20,marginTop:10},

logo:{fontSize:34,color:"#7dd3fc",fontWeight:"700"},

subtitle:{color:"#94a3b8"},

card:{backgroundColor:"#020617",borderRadius:16,padding:20,marginBottom:20,borderWidth:1,borderColor:"#1e293b"},

masterHighlight:{
borderColor:"#38bdf8",
shadowColor:"#38bdf8",
shadowOpacity:0.6,
shadowRadius:12,
shadowOffset:{width:0,height:0},
elevation:8
},

cardTitle:{color:"#e2e8f0",fontSize:18,marginBottom:10,fontWeight:"600",textAlign:"center"},

fileName:{color:"#94a3b8",marginTop:10,textAlign:"center"},

button:{backgroundColor:"#6366f1",padding:16,borderRadius:12,marginTop:10,alignItems:"center"},

reference:{backgroundColor:"#475569",padding:14,borderRadius:12,marginTop:10,alignItems:"center"},

analyze:{backgroundColor:"#0891b2",padding:16,borderRadius:12,marginTop:10,alignItems:"center"},

master:{backgroundColor:"#4f46e5",padding:16,borderRadius:12,marginTop:20,alignItems:"center"},

download:{backgroundColor:"#16a34a",padding:16,borderRadius:12,marginTop:20,alignItems:"center"},

styles:{flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between",marginTop:10},

styleBtn:{backgroundColor:"#1e293b",padding:12,borderRadius:10,width:"48%",alignItems:"center",marginBottom:10},

active:{backgroundColor:"#6366f1"},

panelTitle:{color:"#94a3b8",marginBottom:12,fontWeight:"600",textAlign:"center"},

compareBox:{marginTop:20,alignItems:"center"},

compareTitle:{color:"#94a3b8",marginBottom:10},

compareRow:{flexDirection:"row",gap:10},

preview:{backgroundColor:"#1e293b",padding:12,borderRadius:10},

status:{color:"#38bdf8",textAlign:"center",marginTop:10},

buttonText:{color:"white",fontWeight:"700"},

tip:{color:"#e2e8f0",textAlign:"center",lineHeight:22},

recommend:{color:"#22c55e",fontWeight:"700",marginTop:10,textAlign:"center",fontSize:16},

mixScore:{color:"#38bdf8",fontWeight:"700",marginTop:10,textAlign:"center",fontSize:18},

scoreBarBackground:{
height:8,
backgroundColor:"#1e293b",
borderRadius:10,
marginTop:10,
overflow:"hidden"
},

scoreBarFill:{
height:8,
backgroundColor:"#38bdf8"
},

loadingOverlay:{
position:"absolute",
top:0,
left:0,
right:0,
bottom:0,
backgroundColor:"#000c",
justifyContent:"center",
alignItems:"center",
zIndex:100
},

loadingText:{
color:"white",
marginTop:10,
fontSize:18
},

tagline:{
color:"#64748b",
fontSize:12,
marginTop:4,
letterSpacing:1
},

lufsSub:{
fontSize:12,
color:"#cbd5f5"
}

})