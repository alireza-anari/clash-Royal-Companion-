package com.crc.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.json.JSONException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.nio.charset.StandardCharsets;

/** Decodes only the documented worker result object, not a job response or account assertion. */
public final class VisionReportJson {
    private static final int MAX_BYTES=64*1024, MAX_DEPTH=8, MAX_NODES=2048;
    private VisionReportJson(){}
    public static VisionBattleReport.Report decode(String json,List<Long> expectedTimes,Set<Integer> knownCards){
        if(json==null||json.length()>MAX_BYTES||json.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES)
            throw new IllegalArgumentException("Invalid vision JSON");
        try{
            // Bound nesting before parsing; ignore brackets inside escaped JSON strings.
            int depth=0;boolean quoted=false,escaped=false;
            for(int i=0;i<json.length();i++){
                char ch=json.charAt(i);
                if(quoted){
                    if(escaped)escaped=false;else if(ch=='\\')escaped=true;else if(ch=='"')quoted=false;
                }else if(ch=='"')quoted=true;
                else if(ch=='{'||ch=='['){if(++depth>MAX_DEPTH)throw new IllegalArgumentException();}
                else if(ch=='}'||ch==']'){if(--depth<0)throw new IllegalArgumentException();}
            }
            if(depth!=0||quoted)throw new IllegalArgumentException();
            JSONTokener tokener=new JSONTokener(json);
            Object root=tokener.nextValue();
            if(!(root instanceof JSONObject)||tokener.nextClean()!=0)throw new IllegalArgumentException();
            return VisionBattleReport.parse(convert(root,0,new int[]{0}),expectedTimes,knownCards);
        }catch(JSONException|IllegalArgumentException e){
            // Never propagate provider content or raw JSON in a display/log message.
            throw new IllegalArgumentException("Invalid vision JSON");
        }
    }
    private static Object convert(Object value,int depth,int[] nodes)throws JSONException{
        if(depth>MAX_DEPTH||++nodes[0]>MAX_NODES)throw new IllegalArgumentException();
        if(value==JSONObject.NULL)return null;
        if(value instanceof JSONObject object){
            if(object.length()>16)throw new IllegalArgumentException();
            Map<String,Object> map=new HashMap<>();
            Iterator<String> keys=object.keys();
            while(keys.hasNext()){
                String key=keys.next();
                map.put(key,convert(object.get(key),depth+1,nodes));
            }
            return map;
        }
        if(value instanceof JSONArray array){
            if(array.length()>12)throw new IllegalArgumentException();
            List<Object> list=new ArrayList<>();
            for(int i=0;i<array.length();i++)list.add(convert(array.get(i),depth+1,nodes));
            return list;
        }
        if(value instanceof String||value instanceof Number||value instanceof Boolean)return value;
        throw new IllegalArgumentException();
    }
}
