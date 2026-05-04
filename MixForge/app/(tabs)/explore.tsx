import { View,Text,StyleSheet } from "react-native"

export default function Explore(){

return(

<View style={styles.container}>

<Text style={styles.title}>Explore</Text>

<Text style={styles.text}>
Future MixForge features
</Text>

<Text style={styles.text}>
• AI genre detection
</Text>

<Text style={styles.text}>
• Cloud mastering
</Text>

<Text style={styles.text}>
• User projects
</Text>

<Text style={styles.text}>
• Download masters
</Text>

</View>

)

}

const styles=StyleSheet.create({

container:{
flex:1,
justifyContent:"center",
alignItems:"center",
backgroundColor:"#020617"
},

title:{
fontSize:28,
color:"#7dd3fc",
marginBottom:20
},

text:{
color:"#e2e8f0",
marginBottom:10
}

})
